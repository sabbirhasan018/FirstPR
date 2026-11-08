import { describe, expect, it } from 'vitest';
import {
  benchmarkCandidates,
  ISSUES_NOW,
  makeIssue,
  sampleEvidence,
  sampleHealth,
  sampleRepoContext,
} from './fixtures';
import { rankIssues } from './matcher';
import type { IssueCandidate } from './types';

const rank = (candidates: IssueCandidate[]) =>
  rankIssues({
    candidates,
    evidence: sampleEvidence(),
    health: sampleHealth(),
    repoContext: sampleRepoContext(),
    now: ISSUES_NOW,
  });

describe('rankIssues', () => {
  it('is deterministic', () => {
    const candidates = benchmarkCandidates().map((c) => c.issue);
    expect(rank(candidates)).toEqual(rank(candidates));
  });

  it('excludes assigned issues and says why', () => {
    const result = rank([makeIssue({ hasAssignee: true })]);

    expect(result.ranked).toHaveLength(0);
    expect(result.excluded[0].reason).toContain('Already assigned');
  });

  it('excludes issues in archived repositories', () => {
    const health = sampleHealth();
    const archived = { ...health.get('acme/healthy')!, archived: true };
    const result = rankIssues({
      candidates: [makeIssue()],
      evidence: sampleEvidence(),
      health: new Map([['acme/healthy', archived]]),
      repoContext: sampleRepoContext(),
      now: ISSUES_NOW,
    });

    expect(result.excluded[0].reason).toContain('archived');
  });

  it.each(['blocked', 'needs discussion', 'duplicate', 'wontfix'])(
    'excludes issues labelled %s',
    (label) => {
      const result = rank([makeIssue({ labels: [label] })]);
      expect(result.ranked).toHaveLength(0);
      expect(result.excluded[0].reason).toContain(label);
    },
  );

  it('gives every ranked issue a reason for each major component', () => {
    const result = rank([makeIssue()]);
    const labels = result.ranked[0].reasons.map((r) => r.label);

    expect(labels).toContain('Skill match');
    expect(labels).toContain('Repo health');
    expect(labels).toContain('Specification');
  });

  it('ranks a matching language above a non-matching one', () => {
    const result = rank([
      makeIssue({ repoFullName: 'acme/unknown' }),
      makeIssue({ repoFullName: 'acme/healthy' }),
    ]);

    expect(result.ranked[0].issue.repoFullName).toBe('acme/healthy');
    expect(result.ranked[0].matchedSkills).toContain('TypeScript');
  });

  it('still credits skill match for a repo the budget could not scan', () => {
    // No repoContext entry at all: the repo went unscored, but the language
    // search that found it already proved the language matches.
    const result = rankIssues({
      candidates: [makeIssue({ repoFullName: 'acme/unscanned', searchedLanguage: 'TypeScript' })],
      evidence: sampleEvidence(),
      health: new Map(),
      repoContext: new Map(),
      now: ISSUES_NOW,
    });

    expect(result.ranked[0].matchedSkills).toContain('TypeScript');
    expect(result.ranked[0].reasons.find((r) => r.label === 'Skill match')?.effect).toBe('boost');
  });

  it('treats an unscorable repo as unknown rather than bad', () => {
    const result = rankIssues({
      candidates: [makeIssue({ repoFullName: 'acme/healthy' })],
      evidence: sampleEvidence(),
      health: new Map(),
      repoContext: sampleRepoContext(),
      now: ISSUES_NOW,
    });

    const healthReason = result.ranked[0].reasons.find((r) => r.label === 'Repo health');
    expect(healthReason?.effect).toBe('neutral');
    expect(healthReason?.detail).toContain('Check it yourself');
  });

  it('penalises crowded and stale issues, and warns about them', () => {
    const clean = rank([makeIssue()]).ranked[0];
    const crowded = rank([makeIssue({ commentCount: 40 })]).ranked[0];
    const stale = rank([makeIssue({ updatedAt: '2023-01-01T00:00:00.000Z' })]).ranked[0];

    expect(crowded.score).toBeLessThan(clean.score);
    expect(stale.score).toBeLessThan(clean.score);
    expect(stale.reasons.some((r) => r.label === 'Staleness')).toBe(true);
    expect(crowded.reasons.some((r) => r.label === 'Crowding')).toBe(true);
  });

  it('notes when there is no skill evidence to match against', () => {
    const result = rankIssues({
      candidates: [makeIssue()],
      evidence: { ...sampleEvidence(), skills: [] },
      health: sampleHealth(),
      repoContext: sampleRepoContext(),
      now: ISSUES_NOW,
    });

    expect(result.notes.join(' ')).toContain('No skill evidence');
  });
});

/**
 * The kill condition from the roadmap: if this ranking is no better than
 * filtering by language and the "good first issue" label, the complexity is not
 * earning its keep and should be deleted.
 *
 * The baseline below is that naive approach. The benchmark set is built so both
 * strategies can be judged against a ground truth: some labelled issues sit in
 * an abandoned repo, and some genuinely workable issues carry no label at all.
 */
describe('kill condition: ranking versus a naive label filter', () => {
  /** Language match + beginner label, most recently updated first. */
  function naiveBaseline(candidates: IssueCandidate[]): IssueCandidate[] {
    const context = sampleRepoContext();
    const languages = new Set(
      sampleEvidence()
        .skills.filter((s) => s.category === 'language')
        .map((s) => s.label),
    );

    return candidates
      .filter((issue) => {
        const language = context.get(issue.repoFullName)?.primaryLanguage;
        const labelled = issue.labels.some((l) =>
          ['good first issue', 'help wanted'].includes(l.toLowerCase()),
        );
        return language !== undefined && language !== null && languages.has(language) && labelled;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  function precisionAtK(ordered: IssueCandidate[], truth: Map<number, boolean>, k: number): number {
    const top = ordered.slice(0, k);
    if (top.length === 0) return 0;
    return top.filter((issue) => truth.get(issue.id)).length / top.length;
  }

  it('places genuinely workable issues above labelled ones in dead repos', () => {
    const benchmark = benchmarkCandidates();
    const truth = new Map(benchmark.map((c) => [c.issue.id, c.good]));
    const candidates = benchmark.map((c) => c.issue);

    const rankedOrder = rank(candidates).ranked.map((r) => r.issue);
    const baselineOrder = naiveBaseline(candidates);

    const ranked3 = precisionAtK(rankedOrder, truth, 3);
    const baseline3 = precisionAtK(baselineOrder, truth, 3);

    expect(ranked3).toBeGreaterThan(baseline3);
    // Stated absolutely too, so a future regression cannot hide behind a weak baseline.
    expect(ranked3).toBe(1);
  });

  it('surfaces good issues the naive filter drops entirely', () => {
    const benchmark = benchmarkCandidates();
    const candidates = benchmark.map((c) => c.issue);
    const goodIds = new Set(benchmark.filter((c) => c.good).map((c) => c.issue.id));

    const baselineIds = new Set(naiveBaseline(candidates).map((i) => i.id));
    const rankedIds = new Set(rank(candidates).ranked.map((r) => r.issue.id));

    const missedByBaseline = [...goodIds].filter((id) => !baselineIds.has(id));
    expect(missedByBaseline.length).toBeGreaterThan(0);
    for (const id of missedByBaseline) {
      expect(rankedIds.has(id)).toBe(true);
    }
  });
});
