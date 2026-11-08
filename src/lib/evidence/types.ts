export type SkillCategory = 'language' | 'framework' | 'practice' | 'infrastructure';

export type Confidence = 'strong' | 'moderate' | 'weak';

export type CitationKind = 'language-bytes' | 'file' | 'dependency' | 'topic' | 'merged-pr';

/**
 * A single verifiable observation. Every citation must point at something a
 * human can open and check — a repo, a file path, a dependency, a PR.
 */
export type Citation = {
  kind: CitationKind;
  repo: string;
  detail: string;
  url: string;
};

export type SkillEvidence = {
  skillId: string;
  label: string;
  category: SkillCategory;
  confidence: Confidence;
  /** 0-100, computed from breadth + freshness + depth. Explainable, not learned. */
  score: number;
  breadth: number;
  freshness: number;
  depth: number;
  repoCount: number;
  lastObservedAt: string;
  citations: Citation[];
  rationale: string;
};

export type EvidenceReport = {
  login: string;
  generatedAt: string;
  skills: SkillEvidence[];
  /** Repos that contributed no recognised signal, so the user knows what was skipped. */
  unmatchedRepos: string[];
  notes: string[];
};
