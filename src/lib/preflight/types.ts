export type CheckSeverity = 'blocker' | 'warning' | 'info';

export type CheckOutcome = 'pass' | 'fail' | 'skipped';

export type PreflightCheck = {
  id: string;
  label: string;
  severity: CheckSeverity;
  outcome: CheckOutcome;
  /** What was actually observed. Always concrete, never "looks fine". */
  detail: string;
  /** What to do about it, when there is something to do. */
  fix: string | null;
};

/** A file in the diff, as reported by git. */
export type ChangedFile = {
  path: string;
  added: number;
  removed: number;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
};

/**
 * Everything observed about the branch under review. As everywhere else here,
 * the engine is pure over this and performs no I/O of its own.
 */
export type PreflightInput = {
  /** Branch being proposed. */
  branch: string;
  /** Branch it will merge into. */
  baseBranch: string;
  changedFiles: ChangedFile[];
  /** Commit subjects on the branch, newest first. */
  commitSubjects: string[];
  /** Full commit messages, needed to check for sign-off. */
  commitBodies: string[];
  /** Commits the base has that this branch does not — i.e. how stale it is. */
  behindBy: number;
  /** The pull request title and body the user intends to submit, if drafted. */
  prTitle: string | null;
  prBody: string | null;
  /** The issue this work claims to close, if any. */
  linkedIssue: number | null;
  /** Rules extracted from the target repository, if it was analysed. */
  contributorRuleIds: string[];
  /** Whether the repository defines a test command. */
  hasTestCommand: boolean;
};

export type PreflightReport = {
  checks: PreflightCheck[];
  blockers: number;
  warnings: number;
  /** True when nothing is outstanding that would embarrass the author. */
  readyToOpen: boolean;
  summary: string;
};
