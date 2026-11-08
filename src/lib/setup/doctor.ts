import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RepoAnalysis, SetupRequirement } from '@/lib/repo/types';

const run = promisify(execFile);
const runShell = promisify(exec);

/**
 * Setup Doctor: checks whether this machine can actually build the repository.
 *
 * SECURITY: the only commands this will ever run come from PROBES below — a
 * fixed, hard-coded table of version flags. Nothing from the repository reaches
 * a shell, ever. A repo's package.json, Makefile or CI file can name any
 * command it likes; running those would be arbitrary code execution triggered
 * by browsing someone else's project. The repo decides *which probes are
 * relevant*, never *what gets executed*.
 *
 * execFile is used rather than exec so there is no shell to interpret anything,
 * and arguments are literals, not interpolations.
 */

export type ProbeId = 'node' | 'npm' | 'python' | 'go' | 'docker' | 'docker compose' | 'git';

type Probe = {
  id: ProbeId;
  file: string;
  args: string[];
  /** Pulls the version out of the tool's own output. */
  parse: (output: string) => string | null;
  installHint: string;
};

const SEMVER = /(\d+\.\d+(?:\.\d+)?)/;

const PROBES: Record<ProbeId, Probe> = {
  node: {
    id: 'node',
    file: 'node',
    args: ['--version'],
    parse: (out) => SEMVER.exec(out)?.[1] ?? null,
    installHint: 'Install Node.js from nodejs.org, or use nvm/fnm to match the repo’s version.',
  },
  npm: {
    id: 'npm',
    file: 'npm',
    args: ['--version'],
    parse: (out) => SEMVER.exec(out)?.[1] ?? null,
    installHint: 'npm ships with Node.js; installing Node will provide it.',
  },
  python: {
    id: 'python',
    file: 'python',
    args: ['--version'],
    parse: (out) => SEMVER.exec(out)?.[1] ?? null,
    installHint: 'Install Python from python.org, or use pyenv to match the repo’s version.',
  },
  go: {
    id: 'go',
    file: 'go',
    args: ['version'],
    parse: (out) => SEMVER.exec(out)?.[1] ?? null,
    installHint: 'Install Go from go.dev/dl.',
  },
  docker: {
    id: 'docker',
    file: 'docker',
    args: ['--version'],
    parse: (out) => SEMVER.exec(out)?.[1] ?? null,
    installHint: 'Install Docker Desktop, and make sure the daemon is running.',
  },
  'docker compose': {
    id: 'docker compose',
    file: 'docker',
    args: ['compose', 'version'],
    parse: (out) => SEMVER.exec(out)?.[1] ?? null,
    installHint: 'Docker Compose ships with recent Docker Desktop releases.',
  },
  git: {
    id: 'git',
    file: 'git',
    args: ['--version'],
    parse: (out) => SEMVER.exec(out)?.[1] ?? null,
    installHint: 'Install Git from git-scm.com.',
  },
};

export type CheckStatus = 'ok' | 'wrong-version' | 'missing' | 'unknown';

export type SetupCheck = {
  tool: ProbeId;
  status: CheckStatus;
  /** What the repository asks for, verbatim. Null when it does not say. */
  required: string | null;
  /** What is installed here. Null when the tool is absent. */
  installed: string | null;
  message: string;
  fix: string | null;
};

export type SetupReport = {
  checks: SetupCheck[];
  ready: boolean;
  notes: string[];
};

/** Tools every contribution needs, whatever the repo says. */
const ALWAYS_CHECK: ProbeId[] = ['git'];

export type DoctorDeps = {
  /** Injected so tests never depend on what is installed on the test machine. */
  runProbe?: (probe: Probe) => Promise<string | null>;
};

export async function runSetupDoctor(
  analysis: RepoAnalysis,
  deps: DoctorDeps = {},
): Promise<SetupReport> {
  const probe = deps.runProbe ?? defaultRunProbe;
  const required = requiredProbes(analysis);
  const notes: string[] = [];

  const checks: SetupCheck[] = [];
  for (const id of required) {
    const requirement = analysis.setupRequirements.find((entry) => entry.tool === id);
    const installed = await probe(PROBES[id]);
    checks.push(buildCheck(id, requirement ?? null, installed));
  }

  if (analysis.setupRequirements.length === 0) {
    notes.push(
      'The repository does not state any runtime versions, so these checks only confirm the tools exist.',
    );
  }

  return {
    checks,
    ready: checks.every((check) => check.status === 'ok'),
    notes,
  };
}

/** Which probes the repository's own requirements make relevant. */
function requiredProbes(analysis: RepoAnalysis): ProbeId[] {
  const ids = new Set<ProbeId>(ALWAYS_CHECK);

  for (const requirement of analysis.setupRequirements) {
    if (isProbeId(requirement.tool)) ids.add(requirement.tool);
  }
  if (analysis.ecosystems.includes('node')) {
    ids.add('node');
    ids.add('npm');
  }
  if (analysis.ecosystems.includes('python')) ids.add('python');
  if (analysis.ecosystems.includes('go')) ids.add('go');

  return [...ids];
}

function isProbeId(tool: string): tool is ProbeId {
  return tool in PROBES;
}

function buildCheck(
  tool: ProbeId,
  requirement: SetupRequirement | null,
  installed: string | null,
): SetupCheck {
  const required = requirement?.version ?? null;

  if (!installed) {
    return {
      tool,
      status: 'missing',
      required,
      installed: null,
      message: `${tool} is not installed, or is not on PATH.`,
      fix: PROBES[tool].installHint,
    };
  }

  if (!required) {
    return {
      tool,
      status: 'ok',
      required: null,
      installed,
      message: `${tool} ${installed} found. The repository does not pin a version.`,
      fix: null,
    };
  }

  const satisfied = satisfies(installed, required);
  if (satisfied === null) {
    return {
      tool,
      status: 'unknown',
      required,
      installed,
      message: `${tool} ${installed} found, but the required range "${required}" could not be interpreted. Check it yourself.`,
      fix: null,
    };
  }

  return satisfied
    ? {
        tool,
        status: 'ok',
        required,
        installed,
        message: `${tool} ${installed} satisfies "${required}".`,
        fix: null,
      }
    : {
        tool,
        status: 'wrong-version',
        required,
        installed,
        message: `${tool} ${installed} does not satisfy "${required}".`,
        fix: PROBES[tool].installHint,
      };
}

/**
 * Deliberately handles only the constraint shapes that appear in practice:
 * ">=20", "^20.1.0", "20.11.0", ">=3.11". Anything more exotic returns null so
 * the check reports "unknown" rather than guessing wrong in either direction.
 */
export function satisfies(installed: string, constraint: string): boolean | null {
  // `^22.12.0 || ^24.0.0 || >=26.0.0` is common in modern package.json engines.
  // Any satisfied clause satisfies the whole range.
  if (constraint.includes('||')) {
    const results = constraint.split('||').map((clause) => satisfies(installed, clause));
    if (results.some((result) => result === true)) return true;
    if (results.some((result) => result === null)) return null;
    return false;
  }

  const installedParts = parseVersion(installed);
  if (!installedParts) return null;

  const trimmed = constraint.trim();
  const match = /^([>=^~]*)\s*v?(\d+(?:\.\d+)*)$/.exec(trimmed);
  if (!match) return null;

  const [, operator, version] = match;
  const requiredParts = parseVersion(version);
  if (!requiredParts) return null;

  const comparison = compare(installedParts, requiredParts);

  switch (operator) {
    case '':
      // A bare version in engines/.nvmrc means "at least this", in practice.
      return comparison >= 0;
    case '>=':
      return comparison >= 0;
    case '>':
      return comparison > 0;
    case '^':
      return installedParts[0] === requiredParts[0] && comparison >= 0;
    case '~':
      return (
        installedParts[0] === requiredParts[0] &&
        installedParts[1] === requiredParts[1] &&
        comparison >= 0
      );
    default:
      return null;
  }
}

function parseVersion(value: string): [number, number, number] | null {
  const match = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compare(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * On Windows many tools are batch shims — npm is `npm.cmd`, not an executable —
 * and Node refuses to spawn `.cmd` without a shell (the fix for CVE-2024-27980).
 * Without this, Setup Doctor reports npm as missing on every Windows machine.
 *
 * The shell fallback is safe here for one specific reason: `probe.file` and
 * `probe.args` are compile-time constants from PROBES. No repository content,
 * user input or interpolation ever reaches this call, so there is nothing to
 * inject. The direct, shell-free attempt is still tried first.
 */
function attemptsFor(probe: Probe): { file: string; shell: boolean }[] {
  const direct = { file: probe.file, shell: false };
  if (process.platform !== 'win32') return [direct];
  return [direct, { file: `${probe.file}.cmd`, shell: true }];
}

async function defaultRunProbe(probe: Probe): Promise<string | null> {
  for (const attempt of attemptsFor(probe)) {
    try {
      // The shell path passes one command string rather than an args array:
      // Node deprecates the array form under `shell: true` because arguments
      // are concatenated rather than escaped. Concatenation is fine here only
      // because every part is a constant from PROBES.
      const { stdout, stderr } = attempt.shell
        ? await runShell(`${attempt.file} ${probe.args.join(' ')}`, {
            timeout: 5000,
            windowsHide: true,
          })
        : await run(attempt.file, probe.args, { timeout: 5000, windowsHide: true });

      const version = probe.parse(`${stdout} ${stderr}`);
      if (version) return version;
    } catch {
      // Try the next candidate; a missing binary and a failing one look the same.
    }
  }
  return null;
}
