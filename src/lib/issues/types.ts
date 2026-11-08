/** An open issue observed from GitHub, before any judgement is applied. */
export type IssueCandidate = {
  id: number;
  number: number;
  title: string;
  url: string;
  repoFullName: string;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  hasAssignee: boolean;
  /** Length of the issue body. A proxy for how well specified it is. */
  bodyLength: number;
  /**
   * The language whose search returned this issue. GitHub matched the repo on
   * it, so it stands in for the repo's language when the repo was too expensive
   * to scan.
   */
  searchedLanguage: string | null;
};

export type ReasonEffect = 'boost' | 'penalty' | 'neutral';

export type MatchReason = {
  label: string;
  effect: ReasonEffect;
  detail: string;
};

export type RankedIssue = {
  issue: IssueCandidate;
  /** 0-100. A ranking aid, not a prediction that the PR will be merged. */
  score: number;
  reasons: MatchReason[];
  /** Skills of the user's that this issue's repo appears to exercise. */
  matchedSkills: string[];
};

export type ExcludedIssue = {
  issue: IssueCandidate;
  reason: string;
};

export type IssueRanking = {
  ranked: RankedIssue[];
  excluded: ExcludedIssue[];
  notes: string[];
};
