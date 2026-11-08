import type { ChangedFile, PreflightCheck, PreflightInput, PreflightReport } from './types';

/**
 * PR Preflight: the review a maintainer would give before they read a line of
 * your code, run against your branch before you make them do it.
 *
 * Pure and deterministic. Every check states what was observed, not a verdict:
 * "3 files changed outside src/" rather than "scope looks wrong". The author can
 * then disagree with a fact rather than argue with an opinion.
 *
 * Nothing here posts anything. The report is advice; opening the pull request
 * stays a deliberate human act.
 */

/** Files that should essentially never appear in a contribution. */
const SECRET_FILE = /(^|\/)(\.env(\.|$)|id_rsa|id_ed25519|.*\.pem|.*\.p12|.*\.keystore)/i;

/** Content patterns that look like a credential rather than a placeholder. */
const SECRET_CONTENT = [
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
];

/** Generated or vendored paths a reviewer does not want in the diff. */
const GENERATED_PATH = /(^|\/)(node_modules|vendor|dist|build|out|coverage|\.next|__pycache__)\//;

const LOCKFILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock)$/;

const TEST_PATH =
  /(^|\/)(tests?|spec|__tests__|e2e)\/|\.(test|spec)\.[jt]sx?$|(^|\/)test_[^/]+\.py$/;

const SOURCE_PATH = /\.(m?[jt]sx?|py|go|rs|rb|java)$/;

const DOCS_ONLY = /\.(md|rst|txt)$|^docs\//i;

/** Above this, reviewers start asking for the change to be split. */
const LARGE_DIFF_LINES = 400;
/** Above this, a reviewer will usually refuse outright. */
const HUGE_DIFF_LINES = 1000;
/** Commits behind base beyond which conflicts get likely. */
const STALE_BEHIND = 30;

export type PreflightDeps = {
  /**
   * Diff text, used only for secret scanning. Passed separately because it is
   * large and is never needed for the other checks.
   */
  diffText?: string;
};

export function runPreflight(input: PreflightInput, deps: PreflightDeps = {}): PreflightReport {
  const checks: PreflightCheck[] = [
    hasChanges(input),
    secretsCheck(input, deps.diffText ?? ''),
    generatedFilesCheck(input),
    diffSizeCheck(input),
    testsCheck(input),
    issueLinkCheck(input),
    prDescriptionCheck(input),
    commitMessageCheck(input),
    signOffCheck(input),
    staleBranchCheck(input),
    branchNameCheck(input),
    lockfileCheck(input),
  ];

  const failing = checks.filter((check) => check.outcome === 'fail');
  const blockers = failing.filter((check) => check.severity === 'blocker').length;
  const warnings = failing.filter((check) => check.severity === 'warning').length;

  return {
    checks,
    blockers,
    warnings,
    readyToOpen: blockers === 0,
    summary: summarise(blockers, warnings),
  };
}

function summarise(blockers: number, warnings: number): string {
  if (blockers > 0) {
    return `${blockers} blocker${blockers === 1 ? '' : 's'} to fix before opening this. A maintainer would bounce it otherwise.`;
  }
  if (warnings > 0) {
    return `No blockers. ${warnings} thing${warnings === 1 ? '' : 's'} a reviewer will probably comment on — worth a look, your call.`;
  }
  return 'Nothing outstanding. This is in a state a maintainer can review quickly.';
}

// --- check builders --------------------------------------------------------

function pass(
  id: string,
  label: string,
  severity: PreflightCheck['severity'],
  detail: string,
): PreflightCheck {
  return { id, label, severity, outcome: 'pass', detail, fix: null };
}

function fail(
  id: string,
  label: string,
  severity: PreflightCheck['severity'],
  detail: string,
  fix: string,
): PreflightCheck {
  return { id, label, severity, outcome: 'fail', detail, fix };
}

function skip(id: string, label: string, detail: string): PreflightCheck {
  return { id, label, severity: 'info', outcome: 'skipped', detail, fix: null };
}

// --- checks ----------------------------------------------------------------

function hasChanges(input: PreflightInput): PreflightCheck {
  const count = input.changedFiles.length;
  return count === 0
    ? fail(
        'has-changes',
        'Branch contains changes',
        'blocker',
        'No files differ from the base branch.',
        'Commit your work, or check you are on the right branch.',
      )
    : pass('has-changes', 'Branch contains changes', 'blocker', `${count} file(s) changed.`);
}

function secretsCheck(input: PreflightInput, diffText: string): PreflightCheck {
  const risky = input.changedFiles.filter((file) => SECRET_FILE.test(file.path));
  const leaked = SECRET_CONTENT.filter((pattern) => pattern.test(diffText));

  if (risky.length === 0 && leaked.length === 0) {
    return pass(
      'secrets',
      'No secrets in the diff',
      'blocker',
      diffText
        ? 'No credential-shaped strings or key files found.'
        : 'No credential-shaped filenames found. Diff content was not available to scan.',
    );
  }

  const parts = [
    ...risky.map((file) => file.path),
    ...(leaked.length > 0 ? [`${leaked.length} credential-shaped string(s) in the diff`] : []),
  ];

  return fail(
    'secrets',
    'No secrets in the diff',
    'blocker',
    `Possible secrets: ${parts.join(', ')}.`,
    'Remove them, rotate anything real that was exposed, and rewrite the commits — a force-push does not un-leak a pushed secret.',
  );
}

function generatedFilesCheck(input: PreflightInput): PreflightCheck {
  const generated = input.changedFiles.filter((file) => GENERATED_PATH.test(file.path));
  return generated.length === 0
    ? pass('generated', 'No generated or vendored files', 'warning', 'No build output in the diff.')
    : fail(
        'generated',
        'No generated or vendored files',
        'warning',
        `${generated.length} generated file(s) in the diff, including ${generated[0].path}.`,
        'Remove them from the branch and add the directory to .gitignore.',
      );
}

function diffSizeCheck(input: PreflightInput): PreflightCheck {
  const lines = totalDiffLines(input.changedFiles);
  const reviewable = input.changedFiles.filter((file) => !LOCKFILE.test(file.path));
  const withoutLock = totalDiffLines(reviewable);

  if (withoutLock <= LARGE_DIFF_LINES) {
    return pass('diff-size', 'Reviewable size', 'warning', `${withoutLock} line(s) to review.`);
  }

  return fail(
    'diff-size',
    'Reviewable size',
    withoutLock > HUGE_DIFF_LINES ? 'blocker' : 'warning',
    `${withoutLock} line(s) to review across ${reviewable.length} file(s)${
      lines !== withoutLock ? ' (lockfiles excluded)' : ''
    }.`,
    'Split this into smaller pull requests. Reviewers rarely give a large diff the attention it needs, and a first contribution that is hard to review usually stalls.',
  );
}

function testsCheck(input: PreflightInput): PreflightCheck {
  const touchesSource = input.changedFiles.some(
    (file) => SOURCE_PATH.test(file.path) && !TEST_PATH.test(file.path),
  );
  const touchesTests = input.changedFiles.some((file) => TEST_PATH.test(file.path));
  const docsOnly =
    input.changedFiles.length > 0 && input.changedFiles.every((file) => DOCS_ONLY.test(file.path));

  if (docsOnly) {
    return skip(
      'tests',
      'Tests accompany the change',
      'Documentation-only change; no tests expected.',
    );
  }
  if (!input.hasTestCommand) {
    return skip('tests', 'Tests accompany the change', 'The repository defines no test command.');
  }
  if (!touchesSource) {
    return skip('tests', 'Tests accompany the change', 'No source files changed.');
  }

  return touchesTests
    ? pass('tests', 'Tests accompany the change', 'warning', 'Source and test files both changed.')
    : fail(
        'tests',
        'Tests accompany the change',
        'warning',
        'Source files changed but no test file was touched.',
        'Add a test that fails before your change and passes after it. For a bug fix this is usually what convinces a maintainer the bug was real.',
      );
}

function issueLinkCheck(input: PreflightInput): PreflightCheck {
  if (input.linkedIssue !== null) {
    return pass('issue-link', 'Linked to an issue', 'warning', `Closes #${input.linkedIssue}.`);
  }
  const mentioned = /(closes|fixes|resolves)\s+#\d+/i.test(input.prBody ?? '');
  return mentioned
    ? pass('issue-link', 'Linked to an issue', 'warning', 'The description links an issue.')
    : fail(
        'issue-link',
        'Linked to an issue',
        'warning',
        'No issue is linked.',
        'Add "Closes #123" to the description so the issue closes on merge and the maintainer sees the context.',
      );
}

function prDescriptionCheck(input: PreflightInput): PreflightCheck {
  const body = (input.prBody ?? '').trim();
  if (body.length === 0) {
    return fail(
      'description',
      'Description explains the change',
      'blocker',
      'The pull request has no description.',
      'Say what changed, why, and how you verified it. A reviewer should not have to reconstruct your reasoning from the diff.',
    );
  }
  if (body.length < 80) {
    return fail(
      'description',
      'Description explains the change',
      'warning',
      `The description is ${body.length} characters.`,
      'Add what you changed, why, and how you tested it.',
    );
  }
  return pass(
    'description',
    'Description explains the change',
    'warning',
    `${body.length} characters of description.`,
  );
}

function commitMessageCheck(input: PreflightInput): PreflightCheck {
  if (input.commitSubjects.length === 0) {
    return skip('commit-messages', 'Commit messages are meaningful', 'No commits on the branch.');
  }

  if (input.contributorRuleIds.includes('conventional-commits')) {
    const nonConventional = input.commitSubjects.filter(
      (subject) =>
        !/^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?!?:\s/.test(
          subject,
        ),
    );
    if (nonConventional.length > 0) {
      return fail(
        'commit-messages',
        'Commit messages are meaningful',
        'warning',
        `This repository requires Conventional Commits; ${nonConventional.length} commit(s) do not follow it, e.g. "${nonConventional[0]}".`,
        'Reword with `git rebase -i`, for example "fix: handle empty config".',
      );
    }
  }

  const lazy = input.commitSubjects.filter((subject) =>
    /^(wip|fix|update|changes?|stuff|temp|asdf|test|\.)$/i.test(subject.trim()),
  );

  return lazy.length === 0
    ? pass(
        'commit-messages',
        'Commit messages are meaningful',
        'warning',
        `${input.commitSubjects.length} commit(s), none placeholder.`,
      )
    : fail(
        'commit-messages',
        'Commit messages are meaningful',
        'warning',
        `${lazy.length} placeholder commit message(s), e.g. "${lazy[0]}".`,
        'Reword them with `git rebase -i` so the history explains itself.',
      );
}

function signOffCheck(input: PreflightInput): PreflightCheck {
  if (!input.contributorRuleIds.includes('dco')) {
    return skip(
      'sign-off',
      'Commits are signed off',
      'This repository does not require a DCO sign-off.',
    );
  }
  const missing = input.commitBodies.filter((body) => !/^Signed-off-by:\s.+<.+>/m.test(body));
  return missing.length === 0
    ? pass('sign-off', 'Commits are signed off', 'blocker', 'Every commit carries a sign-off.')
    : fail(
        'sign-off',
        'Commits are signed off',
        'blocker',
        `${missing.length} commit(s) lack a Signed-off-by line, which this repository requires.`,
        `Run \`git rebase --signoff ${input.baseBranch}\` to add it to every commit.`,
      );
}

function staleBranchCheck(input: PreflightInput): PreflightCheck {
  if (input.behindBy === 0) {
    return pass('stale', 'Branch is current', 'warning', `Up to date with ${input.baseBranch}.`);
  }
  return input.behindBy > STALE_BEHIND
    ? fail(
        'stale',
        'Branch is current',
        'warning',
        `${input.behindBy} commits behind ${input.baseBranch}.`,
        `Rebase onto the latest ${input.baseBranch} so CI runs against current code and conflicts surface now rather than in review.`,
      )
    : pass(
        'stale',
        'Branch is current',
        'warning',
        `${input.behindBy} commit(s) behind ${input.baseBranch}, which is fine.`,
      );
}

function branchNameCheck(input: PreflightInput): PreflightCheck {
  const onBase = input.branch === input.baseBranch || /^(main|master|develop)$/.test(input.branch);
  return onBase
    ? fail(
        'branch',
        'Work is on its own branch',
        'blocker',
        `You are committing directly to "${input.branch}".`,
        'Move the work to a topic branch: `git switch -c fix-thing`, then reset the base branch.',
      )
    : pass('branch', 'Work is on its own branch', 'blocker', `On "${input.branch}".`);
}

function lockfileCheck(input: PreflightInput): PreflightCheck {
  const lockfiles = input.changedFiles.filter((file) => LOCKFILE.test(file.path));
  const manifestChanged = input.changedFiles.some((file) =>
    /(^|\/)(package\.json|pyproject\.toml|Cargo\.toml|go\.mod)$/.test(file.path),
  );

  if (lockfiles.length === 0) {
    return pass('lockfile', 'Lockfile consistent with manifest', 'warning', 'No lockfile changes.');
  }
  return manifestChanged
    ? pass(
        'lockfile',
        'Lockfile consistent with manifest',
        'warning',
        'Lockfile and manifest changed together.',
      )
    : fail(
        'lockfile',
        'Lockfile consistent with manifest',
        'warning',
        `${lockfiles[0].path} changed but no dependency manifest did.`,
        'This is usually accidental lockfile churn from a different package-manager version. Revert it unless it is the point of the change.',
      );
}

export function totalDiffLines(files: ChangedFile[]): number {
  return files.reduce((total, file) => total + file.added + file.removed, 0);
}
