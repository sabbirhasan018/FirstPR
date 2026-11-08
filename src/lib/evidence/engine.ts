import type { ProfileSnapshot, RepoSnapshot } from '@/lib/github/types';
import { parseManifest } from './manifests';
import { DETECTION_RULES, type DetectionRule } from './rules';
import type { Citation, Confidence, EvidenceReport, SkillEvidence } from './types';

/**
 * Deterministic skill-evidence engine.
 *
 * No model is involved. Every skill returned is backed by at least one
 * citation a reviewer can open, and the score is a fixed weighted sum of three
 * observable quantities. Two runs over the same snapshot always agree.
 */

const RECENCY_HALF_LIFE_MONTHS = 18;
const FORK_WEIGHT = 0.25;
const ARCHIVED_WEIGHT = 0.6;

/** Repos needed for full breadth credit. */
const BREADTH_TARGET = 3;
/** Weighted bytes needed for full depth credit on a language. */
const DEPTH_BYTES_TARGET = 200_000;
/** Distinct citations needed for full depth credit on a non-language skill. */
const DEPTH_CITATION_TARGET = 4;

const WEIGHTS = { breadth: 0.4, freshness: 0.35, depth: 0.25 } as const;

const STRONG_THRESHOLD = 65;
const MODERATE_THRESHOLD = 35;

/** Half-life decay on how recently a repo was pushed to. Range (0, 1]. */
export function recencyWeight(pushedAt: string, now: Date): number {
  const pushed = new Date(pushedAt).getTime();
  if (!Number.isFinite(pushed)) return 0;
  const months = (now.getTime() - pushed) / (1000 * 60 * 60 * 24 * 30.44);
  if (months <= 0) return 1;
  return 0.5 ** (months / RECENCY_HALF_LIFE_MONTHS);
}

/** How much a repo's contents count as proof of the owner's ability. */
export function repoWeight(repo: RepoSnapshot, now: Date): number {
  let weight = recencyWeight(repo.pushedAt, now);
  if (repo.isFork) weight *= FORK_WEIGHT;
  if (repo.isArchived) weight *= ARCHIVED_WEIGHT;
  return weight;
}

type Accumulator = {
  skillId: string;
  label: string;
  category: SkillEvidence['category'];
  citations: Citation[];
  /** Repos with at least one non-topic (i.e. provable) citation. */
  provingRepos: Map<string, number>;
  weightedBytes: number;
  lastObservedAt: string;
};

export function deriveEvidence(snapshot: ProfileSnapshot, now: Date = new Date()): EvidenceReport {
  const accumulators = new Map<string, Accumulator>();
  const reposWithSignal = new Set<string>();

  for (const repo of snapshot.repos) {
    const weight = repoWeight(repo, now);
    collectLanguageEvidence(repo, weight, accumulators, reposWithSignal);
    collectRuleEvidence(repo, weight, accumulators, reposWithSignal);
  }

  collectCollaborationEvidence(snapshot, accumulators, now);

  const skills: SkillEvidence[] = [];
  for (const acc of accumulators.values()) {
    // Topics are self-declared. A skill proven only by topics is not proven.
    if (acc.provingRepos.size === 0) continue;
    skills.push(finalise(acc));
  }

  skills.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));

  const unmatchedRepos = snapshot.repos
    .filter((repo) => !reposWithSignal.has(repo.fullName))
    .map((repo) => repo.fullName);

  return {
    login: snapshot.login,
    generatedAt: now.toISOString(),
    skills,
    unmatchedRepos,
    notes: buildNotes(snapshot, unmatchedRepos),
  };
}

function collectLanguageEvidence(
  repo: RepoSnapshot,
  weight: number,
  accumulators: Map<string, Accumulator>,
  reposWithSignal: Set<string>,
): void {
  for (const [language, bytes] of Object.entries(repo.languageBytes)) {
    if (bytes <= 0) continue;
    const acc = ensure(accumulators, `language:${language}`, language, 'language');
    acc.weightedBytes += bytes * weight;
    acc.provingRepos.set(repo.fullName, weight);
    acc.citations.push({
      kind: 'language-bytes',
      repo: repo.fullName,
      detail: `${formatBytes(bytes)} of ${language}`,
      url: repo.htmlUrl,
    });
    observe(acc, repo.pushedAt);
    reposWithSignal.add(repo.fullName);
  }
}

function collectRuleEvidence(
  repo: RepoSnapshot,
  weight: number,
  accumulators: Map<string, Accumulator>,
  reposWithSignal: Set<string>,
): void {
  const dependencies = repo.manifests.flatMap(parseManifest);

  for (const rule of DETECTION_RULES) {
    const matches = matchRule(rule, repo, dependencies);
    if (matches.length === 0) continue;

    const acc = ensure(accumulators, rule.id, rule.label, rule.category);
    acc.citations.push(...matches);
    observe(acc, repo.pushedAt);

    if (matches.some((citation) => citation.kind !== 'topic')) {
      acc.provingRepos.set(repo.fullName, weight);
      reposWithSignal.add(repo.fullName);
    }
  }
}

function matchRule(
  rule: DetectionRule,
  repo: RepoSnapshot,
  dependencies: ReturnType<typeof parseManifest>,
): Citation[] {
  const citations: Citation[] = [];

  for (const pattern of rule.paths ?? []) {
    const path = repo.filePaths.find((candidate) => pattern.test(candidate));
    if (path) {
      citations.push({
        kind: 'file',
        repo: repo.fullName,
        detail: path,
        url: `${repo.htmlUrl}/blob/HEAD/${path}`,
      });
      break; // One file per pattern is enough proof; more is just noise.
    }
  }

  for (const wanted of rule.dependencies ?? []) {
    const hit = dependencies.find((dep) => dep.name === wanted.toLowerCase());
    if (hit) {
      citations.push({
        kind: 'dependency',
        repo: repo.fullName,
        detail: `${hit.name} in ${hit.manifestPath}`,
        url: `${repo.htmlUrl}/blob/HEAD/${hit.manifestPath}`,
      });
    }
  }

  for (const topic of rule.topics ?? []) {
    if (repo.topics.includes(topic)) {
      citations.push({
        kind: 'topic',
        repo: repo.fullName,
        detail: `repo topic "${topic}" (self-declared)`,
        url: repo.htmlUrl,
      });
      break;
    }
  }

  return citations;
}

/**
 * Merged pull requests into repos the user does not own are the strongest
 * available signal that they can land changes in someone else's codebase.
 */
function collectCollaborationEvidence(
  snapshot: ProfileSnapshot,
  accumulators: Map<string, Accumulator>,
  now: Date,
): void {
  const external = snapshot.mergedPullRequests.filter(
    (pr) => !pr.repoFullName.toLowerCase().startsWith(`${snapshot.login.toLowerCase()}/`),
  );
  if (external.length === 0) return;

  const acc = ensure(
    accumulators,
    'oss-collaboration',
    'Landing changes in other people’s repos',
    'practice',
  );

  for (const pr of external) {
    acc.provingRepos.set(pr.repoFullName, recencyWeight(pr.mergedAtApprox, now));
    acc.citations.push({
      kind: 'merged-pr',
      repo: pr.repoFullName,
      detail: pr.title,
      url: pr.url,
    });
    observe(acc, pr.mergedAtApprox);
  }
}

function finalise(acc: Accumulator): SkillEvidence {
  const weightedRepoCount = sum(acc.provingRepos.values());
  const breadth = clamp01(weightedRepoCount / BREADTH_TARGET);
  const freshness = Math.max(0, ...acc.provingRepos.values());
  const depth =
    acc.category === 'language'
      ? clamp01(Math.log10(1 + acc.weightedBytes) / Math.log10(1 + DEPTH_BYTES_TARGET))
      : clamp01(distinctProvingCitations(acc) / DEPTH_CITATION_TARGET);

  const score = Math.round(
    100 * (WEIGHTS.breadth * breadth + WEIGHTS.freshness * freshness + WEIGHTS.depth * depth),
  );

  const confidence: Confidence =
    score >= STRONG_THRESHOLD ? 'strong' : score >= MODERATE_THRESHOLD ? 'moderate' : 'weak';

  return {
    skillId: acc.skillId,
    label: acc.label,
    category: acc.category,
    confidence,
    score,
    breadth: round2(breadth),
    freshness: round2(freshness),
    depth: round2(depth),
    repoCount: acc.provingRepos.size,
    lastObservedAt: acc.lastObservedAt,
    citations: acc.citations,
    rationale: buildRationale(acc, breadth, freshness, depth),
  };
}

function buildRationale(
  acc: Accumulator,
  breadth: number,
  freshness: number,
  depth: number,
): string {
  const repos = `${acc.provingRepos.size} repo${acc.provingRepos.size === 1 ? '' : 's'}`;
  const depthPhrase =
    acc.category === 'language'
      ? `${formatBytes(Math.round(acc.weightedBytes))} of recency-weighted code`
      : `${distinctProvingCitations(acc)} distinct artefact${distinctProvingCitations(acc) === 1 ? '' : 's'}`;
  const freshPhrase =
    freshness >= 0.7 ? 'active recently' : freshness >= 0.35 ? 'last touched a while ago' : 'largely dormant';

  return (
    `Observed in ${repos} (breadth ${round2(breadth)}), ${depthPhrase} (depth ${round2(depth)}), ` +
    `${freshPhrase} (freshness ${round2(freshness)}).`
  );
}

function buildNotes(snapshot: ProfileSnapshot, unmatchedRepos: string[]): string[] {
  const notes = [...snapshot.warnings];
  const truncated = snapshot.repos.filter((repo) => repo.treeTruncated).map((repo) => repo.fullName);
  if (truncated.length > 0) {
    notes.push(
      `File listing was truncated by GitHub for ${truncated.length} large repo(s); some evidence may be missing: ${truncated.join(', ')}.`,
    );
  }
  if (unmatchedRepos.length > 0) {
    notes.push(`${unmatchedRepos.length} repo(s) produced no recognised signal and were not scored.`);
  }
  return notes;
}

function ensure(
  accumulators: Map<string, Accumulator>,
  skillId: string,
  label: string,
  category: SkillEvidence['category'],
): Accumulator {
  const existing = accumulators.get(skillId);
  if (existing) return existing;
  const created: Accumulator = {
    skillId,
    label,
    category,
    citations: [],
    provingRepos: new Map(),
    weightedBytes: 0,
    lastObservedAt: '1970-01-01T00:00:00.000Z',
  };
  accumulators.set(skillId, created);
  return created;
}

function observe(acc: Accumulator, at: string): void {
  if (at > acc.lastObservedAt) acc.lastObservedAt = at;
}

function distinctProvingCitations(acc: Accumulator): number {
  return new Set(
    acc.citations.filter((c) => c.kind !== 'topic').map((c) => `${c.repo}:${c.detail}`),
  ).size;
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} kB`;
  return `${bytes} B`;
}
