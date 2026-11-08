import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ChangedFile, PreflightInput } from './types';

const run = promisify(execFile);

/**
 * Reads the state of a local branch with git.
 *
 * Every git invocation below uses a fixed subcommand and fixed flags. The only
 * values that vary are the working directory and the base branch name, and the
 * branch name is validated against a conservative pattern first — a ref name is
 * not a place to accept arbitrary text, since several git flags would otherwise
 * be reachable through a leading dash.
 *
 * `execFile` is used rather than `exec`, so no shell interprets any of it. Every
 * command is read-only: nothing here writes, commits, pushes or checks out.
 */

const REF_NAME = /^[A-Za-z0-9._/-]{1,120}$/;

/** Diff text is only used for secret scanning; large diffs are truncated. */
const MAX_DIFF_BYTES = 2_000_000;

export class PreflightError extends Error {}

export type CollectPreflightOptions = {
  repoPath: string;
  baseBranch?: string;
  prTitle?: string | null;
  prBody?: string | null;
  linkedIssue?: number | null;
  contributorRuleIds?: string[];
  hasTestCommand?: boolean;
};

export type CollectedPreflight = {
  input: PreflightInput;
  diffText: string;
};

export async function collectPreflight(
  options: CollectPreflightOptions,
): Promise<CollectedPreflight> {
  const cwd = options.repoPath.trim();
  if (!cwd) throw new PreflightError('Enter the path to a local git repository.');

  const requestedBase = (options.baseBranch ?? '').trim();
  if (requestedBase && !REF_NAME.test(requestedBase)) {
    throw new PreflightError(`"${requestedBase}" is not a valid branch name.`);
  }

  await assertGitRepo(cwd);

  const baseBranch = requestedBase || (await detectDefaultBranch(cwd));
  await assertRefExists(cwd, baseBranch);

  const branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const changedFiles = parseNumstat(await git(cwd, ['diff', '--numstat', `${baseBranch}...HEAD`]));
  const commitSubjects = splitLines(await git(cwd, ['log', '--format=%s', `${baseBranch}..HEAD`]));
  const commitBodies = (await git(cwd, ['log', '--format=%B%x00', `${baseBranch}..HEAD`]))
    .split('\0')
    .map((body) => body.trim())
    .filter(Boolean);
  const behindBy = Number(
    (await git(cwd, ['rev-list', '--count', `HEAD..${baseBranch}`])).trim() || '0',
  );

  const diffText = (await git(cwd, ['diff', `${baseBranch}...HEAD`])).slice(0, MAX_DIFF_BYTES);

  return {
    diffText,
    input: {
      branch,
      baseBranch,
      changedFiles,
      commitSubjects,
      commitBodies,
      behindBy: Number.isFinite(behindBy) ? behindBy : 0,
      prTitle: options.prTitle ?? null,
      prBody: options.prBody ?? null,
      linkedIssue: options.linkedIssue ?? null,
      contributorRuleIds: options.contributorRuleIds ?? [],
      hasTestCommand: options.hasTestCommand ?? false,
    },
  };
}

async function assertGitRepo(cwd: string): Promise<void> {
  try {
    const inside = (await git(cwd, ['rev-parse', '--is-inside-work-tree'])).trim();
    if (inside !== 'true') throw new PreflightError(`"${cwd}" is not a git working tree.`);
  } catch (error) {
    if (error instanceof PreflightError) throw error;
    throw new PreflightError(`"${cwd}" is not a git repository, or could not be read.`);
  }
}

async function assertRefExists(cwd: string, ref: string): Promise<void> {
  try {
    await git(cwd, ['rev-parse', '--verify', `${ref}^{commit}`]);
  } catch {
    throw new PreflightError(
      `Branch "${ref}" does not exist in this repository. Fetch it, or name a different base.`,
    );
  }
}

/** Best guess at the base branch when the user does not name one. */
async function detectDefaultBranch(cwd: string): Promise<string> {
  for (const candidate of ['origin/HEAD', 'main', 'master']) {
    try {
      const resolved = (await git(cwd, ['rev-parse', '--abbrev-ref', candidate])).trim();
      if (resolved) return resolved.replace(/^origin\//, '');
    } catch {
      // Try the next candidate.
    }
  }
  return 'main';
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, {
    cwd,
    maxBuffer: 10_000_000,
    timeout: 20_000,
    windowsHide: true,
  });
  return stdout;
}

export function parseNumstat(output: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const line of splitLines(output)) {
    const [added, removed, path] = line.split('\t');
    if (!path) continue;
    files.push({
      path: path.trim(),
      // Binary files report "-" rather than a count.
      added: added === '-' ? 0 : Number(added) || 0,
      removed: removed === '-' ? 0 : Number(removed) || 0,
      status: 'modified',
    });
  }
  return files;
}

function splitLines(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
