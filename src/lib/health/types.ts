/** A closed pull request, reduced to the fields that say something about the repo. */
export type PullRequestFact = {
  createdAt: string;
  updatedAt: string;
  /** Null when the PR was closed without merging. */
  mergedAt: string | null;
};

export type IssueFact = {
  createdAt: string;
  closedAt: string | null;
  commentCount: number;
};

export type WorkflowRunFact = {
  /** GitHub's conclusion string: success, failure, cancelled, ... */
  conclusion: string | null;
  createdAt: string;
};

/**
 * Observed facts about one repository. As with the evidence engine, nothing here
 * is inferred — this is the raw material the scorer reasons over.
 */
export type RepoHealthSnapshot = {
  fullName: string;
  htmlUrl: string;
  description: string | null;
  stars: number;
  isArchived: boolean;
  isFork: boolean;
  pushedAt: string;
  createdAt: string;
  openIssueCount: number;
  primaryLanguage: string | null;
  topics: string[];
  license: string | null;
  closedPullRequests: PullRequestFact[];
  openPullRequests: PullRequestFact[];
  recentIssues: IssueFact[];
  latestReleaseAt: string | null;
  workflowRuns: WorkflowRunFact[];
  hasContributingDoc: boolean;
  hasIssueTemplates: boolean;
  /** Endpoints that could not be read, so their signals are absent not zero. */
  unavailable: string[];
};

export type SignalId =
  | 'maintainer-activity'
  | 'merge-activity'
  | 'issue-responsiveness'
  | 'ci-health'
  | 'release-cadence'
  | 'open-pr-freshness'
  | 'contributor-docs';

export type HealthSignal = {
  id: SignalId;
  label: string;
  /** 0-1, or null when the underlying data was unavailable. */
  value: number | null;
  weight: number;
  /** Plain-language statement of what was actually observed. */
  detail: string;
};

export type HealthBand = 'healthy' | 'mixed' | 'risky' | 'insufficient-data';

export type RepoHealth = {
  fullName: string;
  htmlUrl: string;
  /**
   * 0-100, or null when too little was observable to say anything.
   *
   * This is NOT a probability that a pull request will be merged. It is a
   * weighted summary of observable maintenance behaviour, and it is only ever
   * shown next to the signals it was computed from.
   */
  survivalScore: number | null;
  band: HealthBand;
  signals: HealthSignal[];
  /** Fraction of total weight that was actually observable, 0-1. */
  coverage: number;
  archived: boolean;
  summary: string;
};
