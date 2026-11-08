import { buildImportGraph } from './graph';
import type {
  ContributorRule,
  DirectoryRole,
  Ecosystem,
  FileRef,
  KeyDirectory,
  RepoAnalysis,
  RepoAnalysisSnapshot,
  RepoCommand,
  SetupRequirement,
} from './types';

/**
 * "Understand this repo in ten minutes."
 *
 * Pure analysis over an observed file tree and a handful of read files. Like the
 * other engines here, it derives nothing it cannot point at: every entry point,
 * command and requirement carries the file it came from.
 *
 * No model is involved. A language model asked "how do I build this repo?" will
 * confidently invent `npm run build` for a project that has no such script; this
 * reads the script list instead.
 */

/** Directories that describe the environment rather than the project. */
const IGNORED_DIRS = new Set([
  'node_modules',
  'vendor',
  'dist',
  'build',
  'target',
  '.git',
  '.next',
  '__pycache__',
  'venv',
  '.venv',
]);

const DIRECTORY_ROLES: { role: DirectoryRole; match: RegExp }[] = [
  { role: 'tests', match: /^(tests?|spec|__tests__|e2e)$/i },
  { role: 'docs', match: /^(docs?|documentation)$/i },
  { role: 'migrations', match: /^(migrations?|db|prisma)$/i },
  { role: 'ci', match: /^\.github$/i },
  { role: 'examples', match: /^(examples?|samples?|demo)$/i },
  { role: 'config', match: /^(config|conf|settings)$/i },
  { role: 'source', match: /^(src|lib|app|pkg|cmd|internal|server|client)$/i },
];

/**
 * Contributor guidance, in every extension projects actually use. Python
 * projects overwhelmingly write reStructuredText, so matching only .md silently
 * reports "no contributor rules" for a large slice of the ecosystem.
 */
const CONTRIBUTING_FILE =
  /^(\.github\/)?(CONTRIBUTING|PULL_REQUEST_TEMPLATE)(\.(md|rst|txt))?$/i;

const ENTRY_POINT_PATTERNS = [
  /^src\/(index|main|app)\.[jt]sx?$/,
  /^(index|main|app|server)\.[jt]sx?$/,
  /^src\/app\/(page|layout)\.tsx$/,
  /^(main|app|__main__|manage|wsgi|asgi)\.py$/,
  /^src\/(main|app|__main__)\.py$/,
  // A packaged Python project's public surface is its package __init__.
  /^src\/[^/]+\/__init__\.py$/,
  /^[^/]+\/__init__\.py$/,
  /^cmd\/[^/]+\/main\.go$/,
  /^main\.go$/,
  /^src\/main\.rs$/,
  /^src\/lib\.rs$/,
];

/** Commands shown per category. Enough to be useful, few enough to read. */
const MAX_COMMANDS_PER_KIND = 4;

/** package.json script names mapped to what they actually are. */
const SCRIPT_KINDS: { kind: RepoCommand['kind']; match: RegExp }[] = [
  { kind: 'test', match: /^(test|tests|test:unit|jest|vitest)$/ },
  { kind: 'build', match: /^(build|compile)$/ },
  { kind: 'lint', match: /^(lint|lint:fix|eslint)$/ },
  { kind: 'typecheck', match: /^(typecheck|type-check|tsc)$/ },
  { kind: 'dev', match: /^(dev|start|serve)$/ },
];

const CONTRIBUTOR_RULE_PATTERNS: { id: string; label: string; match: RegExp }[] = [
  { id: 'dco', label: 'Sign-off required', match: /signed-off-by|DCO|developer certificate of origin/i },
  { id: 'cla', label: 'CLA required', match: /contributor licen[cs]e agreement|\bCLA\b/i },
  {
    id: 'conventional-commits',
    label: 'Conventional commit messages',
    match: /conventional commits?|commit message (format|convention)/i,
  },
  { id: 'issue-first', label: 'Open an issue first', match: /open an issue (first|before)|discuss.{0,20}before (you )?(start|submit)/i },
  { id: 'tests-required', label: 'Tests required with changes', match: /(add|include|write).{0,30}tests?\b|tests? (are )?required/i },
  { id: 'changelog', label: 'Changelog entry expected', match: /update the changelog|add a changelog entry|changeset/i },
  { id: 'squash', label: 'Squash or rebase expected', match: /squash your commits|rebase (onto|on) (main|master)/i },
];

export function analyzeRepo(snapshot: RepoAnalysisSnapshot): RepoAnalysis {
  const paths = snapshot.filePaths.filter((path) => !isIgnored(path));
  const fileOf = (path: string) => snapshot.files.find((file) => file.path === path);
  const ref = (path: string, excerpt?: string): FileRef => ({
    path,
    url: `${snapshot.htmlUrl}/blob/${snapshot.defaultBranch}/${path}`,
    ...(excerpt ? { excerpt } : {}),
  });

  const ecosystems = detectEcosystems(paths);
  const commands: RepoCommand[] = [
    ...packageJsonCommands(fileOf('package.json'), ref),
    ...makefileCommands(fileOf('Makefile'), ref),
    ...ciCommands(snapshot.files, ref),
    ...ecosystemDefaults(ecosystems, paths, ref),
  ];

  return {
    fullName: snapshot.fullName,
    htmlUrl: snapshot.htmlUrl,
    defaultBranch: snapshot.defaultBranch,
    ecosystems,
    entryPoints: findEntryPoints(paths, ref),
    keyDirectories: findKeyDirectories(paths),
    commands: dedupeCommands(commands),
    setupRequirements: findSetupRequirements(snapshot.files, paths, ref),
    contributorRules: findContributorRules(snapshot.files, ref),
    importGraph: buildImportGraph(snapshot.files, snapshot.sourcePaths),
    fileCount: paths.length,
    notes: buildNotes(snapshot, paths),
  };
}

// --- ecosystems ------------------------------------------------------------

function detectEcosystems(paths: string[]): Ecosystem[] {
  const markers: [Ecosystem, string[]][] = [
    ['node', ['package.json']],
    ['python', ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile']],
    ['go', ['go.mod']],
    ['rust', ['Cargo.toml']],
    ['ruby', ['Gemfile']],
    ['java', ['pom.xml', 'build.gradle', 'build.gradle.kts']],
  ];

  const found = markers
    .filter(([, files]) => files.some((file) => paths.includes(file)))
    .map(([ecosystem]) => ecosystem);

  return found.length > 0 ? found : ['unknown'];
}

// --- entry points and structure -------------------------------------------

function findEntryPoints(paths: string[], ref: (p: string) => FileRef): FileRef[] {
  return paths
    .filter((path) => ENTRY_POINT_PATTERNS.some((pattern) => pattern.test(path)))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    .slice(0, 8)
    .map((path) => ref(path));
}

function findKeyDirectories(paths: string[]): KeyDirectory[] {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const top = path.includes('/') ? path.slice(0, path.indexOf('/')) : null;
    if (!top) continue;
    counts.set(top, (counts.get(top) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([path, fileCount]) => ({ path, fileCount, role: roleOf(path) }))
    // Named roles first, then by size: a reader wants src/ and tests/ before assets/.
    .sort((a, b) => {
      const aNamed = a.role === 'other' ? 1 : 0;
      const bNamed = b.role === 'other' ? 1 : 0;
      return aNamed - bNamed || b.fileCount - a.fileCount || a.path.localeCompare(b.path);
    })
    .slice(0, 12);
}

function roleOf(dir: string): DirectoryRole {
  return DIRECTORY_ROLES.find(({ match }) => match.test(dir))?.role ?? 'other';
}

// --- commands --------------------------------------------------------------

function packageJsonCommands(
  file: { path: string; content: string } | undefined,
  ref: (p: string, e?: string) => FileRef,
): RepoCommand[] {
  if (!file) return [];
  let scripts: Record<string, string>;
  try {
    const json = JSON.parse(file.content) as { scripts?: Record<string, string> };
    scripts = json.scripts ?? {};
  } catch {
    return [];
  }

  const commands: RepoCommand[] = [];
  for (const [name, script] of Object.entries(scripts)) {
    const kind = SCRIPT_KINDS.find(({ match }) => match.test(name))?.kind;
    if (!kind) continue;
    commands.push({
      kind,
      command: `npm run ${name}`,
      source: ref(file.path, `"${name}": "${script}"`),
      fromCi: false,
    });
  }
  return commands;
}

function makefileCommands(
  file: { path: string; content: string } | undefined,
  ref: (p: string, e?: string) => FileRef,
): RepoCommand[] {
  if (!file) return [];
  const commands: RepoCommand[] = [];

  for (const line of file.content.split(/\r?\n/)) {
    const target = /^([a-zA-Z][\w-]*):(?!=)/.exec(line)?.[1];
    if (!target) continue;
    const kind = SCRIPT_KINDS.find(({ match }) => match.test(target))?.kind;
    if (!kind) continue;
    commands.push({
      kind,
      command: `make ${target}`,
      source: ref(file.path, line.trim()),
      fromCi: false,
    });
  }
  return commands;
}

/**
 * Commands lifted from CI workflows. These matter most: whatever CI runs is what
 * a pull request has to survive, regardless of what the README suggests.
 */
function ciCommands(
  files: { path: string; content: string }[],
  ref: (p: string, e?: string) => FileRef,
): RepoCommand[] {
  const commands: RepoCommand[] = [];

  for (const file of files) {
    if (!/^\.github\/workflows\/.+\.ya?ml$/.test(file.path)) continue;

    for (const run of extractRunCommands(file.content)) {
      if (run.startsWith('${{')) continue;
      const kind = classifyCommand(run);
      if (!kind) continue;
      commands.push({
        kind,
        command: stripQuotes(run),
        source: ref(file.path, run),
        fromCi: true,
      });
    }
  }
  return commands;
}

/**
 * Pulls shell commands out of workflow `run:` steps, including block scalars.
 * Most real workflows use `run: |` with several lines, so reading only the
 * single-line form misses nearly everything that matters.
 */
export function extractRunCommands(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/);
  const commands: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = /^(\s*)(?:-\s*)?run:\s*(.*)$/.exec(line);
    if (!match) continue;

    const [, indent, rest] = match;
    const value = rest.trim();

    // Inline form: `run: npm test`
    if (value && value !== '|' && value !== '>' && value !== '|-' && value !== '>-') {
      commands.push(value);
      continue;
    }

    // Block form: consume the more-indented lines that follow.
    const blockIndent = indent.length;
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j];
      if (next.trim() === '') continue;
      const nextIndent = next.length - next.trimStart().length;
      if (nextIndent <= blockIndent) break;

      const command = next.trim();
      // Skip shell continuations and comments; they are not runnable on their own.
      if (command.startsWith('#') || command === '\\') continue;
      commands.push(command);
    }
  }

  return commands;
}

/**
 * Order matters. `tox run -e typing` is a type check that happens to run through
 * a test runner, so the narrower category is tested first.
 *
 * Runner names, not just the word "test", because a great many projects never
 * say it: Flask's entire test suite runs as `uv run ... tox run`.
 */
/**
 * Shell plumbing that appears inside CI steps but is not how anyone builds or
 * tests the project. Matching on the leading executable rather than the whole
 * line matters: `cp ./test/e2e/index.html ...` contains "test" and would
 * otherwise be presented as the way to run the test suite.
 */
const NOISE_COMMANDS = new Set([
  'cp',
  'mv',
  'rm',
  'mkdir',
  'touch',
  'echo',
  'cat',
  'chmod',
  'curl',
  'wget',
  'tar',
  'unzip',
  'git',
  'ls',
  'sed',
  'awk',
  'export',
  'source',
  'sleep',
]);

function classifyCommand(command: string): RepoCommand['kind'] | null {
  const c = command.toLowerCase();

  const leading = c.trim().split(/\s+/)[0];
  if (NOISE_COMMANDS.has(leading)) return null;

  if (
    /\b(npm|yarn|pnpm)\s+(ci|install)\b|pip install|uv sync|poetry install|go mod download|bundle install/.test(
      c,
    )
  ) {
    return 'install';
  }
  if (/\b(tsc|typecheck|type-check|mypy|pyright|typing)\b/.test(c)) return 'typecheck';
  if (/\b(lint|eslint|ruff|flake8|golangci-lint|black|prettier|pre-commit)\b/.test(c)) return 'lint';
  if (/\b(test|tests|tox|nox|pytest|unittest|jest|vitest|mocha|rspec)\b/.test(c)) return 'test';
  if (/\b(build|compile)\b/.test(c)) return 'build';
  return null;
}

/** Conventional commands implied by an ecosystem's presence, as a last resort. */
function ecosystemDefaults(
  ecosystems: Ecosystem[],
  paths: string[],
  ref: (p: string, e?: string) => FileRef,
): RepoCommand[] {
  const commands: RepoCommand[] = [];

  if (ecosystems.includes('node') && paths.includes('package.json')) {
    const { command, lockfile } = nodeInstall(paths);
    commands.push({ kind: 'install', command, source: ref(lockfile), fromCi: false });
  }
  if (ecosystems.includes('python') && paths.includes('requirements.txt')) {
    commands.push({
      kind: 'install',
      command: 'pip install -r requirements.txt',
      source: ref('requirements.txt'),
      fromCi: false,
    });
  }
  if (ecosystems.includes('go') && paths.includes('go.mod')) {
    commands.push({ kind: 'test', command: 'go test ./...', source: ref('go.mod'), fromCi: false });
  }
  if (ecosystems.includes('rust') && paths.includes('Cargo.toml')) {
    commands.push({
      kind: 'test',
      command: 'cargo test',
      source: ref('Cargo.toml'),
      fromCi: false,
    });
  }
  return commands;
}

/**
 * The lockfile decides the package manager. Telling someone to run
 * `npm install` in a pnpm workspace produces a broken tree and a confusing
 * first five minutes.
 */
function nodeInstall(paths: string[]): { command: string; lockfile: string } {
  if (paths.includes('pnpm-lock.yaml')) return { command: 'pnpm install', lockfile: 'pnpm-lock.yaml' };
  if (paths.includes('yarn.lock')) return { command: 'yarn install', lockfile: 'yarn.lock' };
  if (paths.includes('bun.lockb')) return { command: 'bun install', lockfile: 'bun.lockb' };
  if (paths.includes('package-lock.json')) {
    return { command: 'npm ci', lockfile: 'package-lock.json' };
  }
  return { command: 'npm install', lockfile: 'package.json' };
}

/** CI-sourced commands win; otherwise first of each kind+command wins. */
function dedupeCommands(commands: RepoCommand[]): RepoCommand[] {
  const byKey = new Map<string, RepoCommand>();
  for (const command of commands) {
    const key = `${command.kind}:${command.command}`;
    const existing = byKey.get(key);
    if (!existing || (command.fromCi && !existing.fromCi)) byKey.set(key, command);
  }

  const order: RepoCommand['kind'][] = ['install', 'build', 'test', 'lint', 'typecheck', 'dev'];
  const sorted = [...byKey.values()].sort(
    (a, b) =>
      order.indexOf(a.kind) - order.indexOf(b.kind) ||
      Number(b.fromCi) - Number(a.fromCi) ||
      a.command.localeCompare(b.command),
  );

  // A large monorepo's CI can define dozens of steps per kind. Showing all of
  // them defeats the point: the reader wants the few commands that matter, and
  // CI-sourced ones sort first so those are what survive the cut.
  const perKind = new Map<RepoCommand['kind'], number>();
  return sorted.filter((command) => {
    const seen = perKind.get(command.kind) ?? 0;
    perKind.set(command.kind, seen + 1);
    return seen < MAX_COMMANDS_PER_KIND;
  });
}

// --- setup requirements ----------------------------------------------------

function findSetupRequirements(
  files: { path: string; content: string }[],
  paths: string[],
  ref: (p: string, e?: string) => FileRef,
): SetupRequirement[] {
  const requirements: SetupRequirement[] = [];
  const find = (path: string) => files.find((file) => file.path === path);

  const packageJson = find('package.json');
  if (packageJson) {
    try {
      const json = JSON.parse(packageJson.content) as { engines?: Record<string, string> };
      const node = json.engines?.node;
      requirements.push({
        tool: 'node',
        version: node ?? null,
        source: ref('package.json', node ? `"engines": { "node": "${node}" }` : undefined),
      });
    } catch {
      requirements.push({ tool: 'node', version: null, source: ref('package.json') });
    }
  }

  const nvmrc = find('.nvmrc');
  if (nvmrc) {
    requirements.push({
      tool: 'node',
      version: nvmrc.content.trim(),
      source: ref('.nvmrc', nvmrc.content.trim()),
    });
  }

  const pyproject = find('pyproject.toml');
  if (pyproject) {
    const requires = /requires-python\s*=\s*"([^"]+)"/.exec(pyproject.content)?.[1] ?? null;
    requirements.push({
      tool: 'python',
      version: requires,
      source: ref('pyproject.toml', requires ? `requires-python = "${requires}"` : undefined),
    });
  } else if (paths.includes('requirements.txt') || paths.includes('setup.py')) {
    requirements.push({
      tool: 'python',
      version: null,
      source: ref(paths.includes('requirements.txt') ? 'requirements.txt' : 'setup.py'),
    });
  }

  const goMod = find('go.mod');
  if (goMod) {
    const version = /^go\s+([\d.]+)/m.exec(goMod.content)?.[1] ?? null;
    requirements.push({
      tool: 'go',
      version,
      source: ref('go.mod', version ? `go ${version}` : undefined),
    });
  }

  if (paths.some((path) => /^Dockerfile$/i.test(path))) {
    requirements.push({ tool: 'docker', version: null, source: ref('Dockerfile') });
  }
  const compose = paths.find((path) => /^(docker-)?compose\.ya?ml$/.test(path));
  if (compose) {
    requirements.push({ tool: 'docker compose', version: null, source: ref(compose) });
  }

  return dedupeRequirements(requirements);
}

/** A pinned version beats an unpinned mention of the same tool. */
function dedupeRequirements(requirements: SetupRequirement[]): SetupRequirement[] {
  const byTool = new Map<string, SetupRequirement>();
  for (const requirement of requirements) {
    const existing = byTool.get(requirement.tool);
    if (!existing || (!existing.version && requirement.version)) {
      byTool.set(requirement.tool, requirement);
    }
  }
  return [...byTool.values()];
}

// --- contributor rules -----------------------------------------------------

function findContributorRules(
  files: { path: string; content: string }[],
  ref: (p: string, e?: string) => FileRef,
): ContributorRule[] {
  const sources = files.filter((file) => CONTRIBUTING_FILE.test(file.path));

  const rules: ContributorRule[] = [];
  const seen = new Set<string>();

  for (const file of sources) {
    const lines = file.content.split(/\r?\n/);
    for (const { id, label, match } of CONTRIBUTOR_RULE_PATTERNS) {
      if (seen.has(id)) continue;
      const line = lines.find((candidate) => match.test(candidate));
      if (!line) continue;
      seen.add(id);
      rules.push({
        id,
        label,
        detail: truncate(line.replace(/^[-*>\s#]+/, '').trim(), 200),
        source: ref(file.path, truncate(line.trim(), 200)),
      });
    }
  }
  return rules;
}

// --- helpers ---------------------------------------------------------------

function buildNotes(snapshot: RepoAnalysisSnapshot, paths: string[]): string[] {
  const notes: string[] = [];
  if (snapshot.treeTruncated) {
    notes.push(
      'GitHub truncated the file listing for this repository, so parts of the structure are missing.',
    );
  }
  if (!snapshot.files.some((file) => CONTRIBUTING_FILE.test(file.path))) {
    notes.push('No CONTRIBUTING guide was found — expect house rules to be undocumented.');
  }
  if (!paths.some((path) => /^\.github\/workflows\//.test(path))) {
    notes.push('No GitHub Actions workflows found, so there is no CI definition to read commands from.');
  }
  return notes;
}

function isIgnored(path: string): boolean {
  return path.split('/').some((segment) => IGNORED_DIRS.has(segment));
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, '');
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
