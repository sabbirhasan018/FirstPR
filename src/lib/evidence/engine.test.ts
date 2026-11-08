import { describe, expect, it } from 'vitest';
import { deriveEvidence, recencyWeight, repoWeight } from './engine';
import { FIXTURE_NOW, makeRepo, makeSnapshot, sampleSnapshot } from './fixtures';

const find = (report: ReturnType<typeof deriveEvidence>, skillId: string) =>
  report.skills.find((skill) => skill.skillId === skillId);

describe('recencyWeight', () => {
  it('is 1 for a push happening now and halves every 18 months', () => {
    expect(recencyWeight(FIXTURE_NOW.toISOString(), FIXTURE_NOW)).toBe(1);
    const eighteenMonthsAgo = new Date('2024-07-02T00:00:00.000Z').toISOString();
    expect(recencyWeight(eighteenMonthsAgo, FIXTURE_NOW)).toBeCloseTo(0.5, 1);
  });

  it('returns 0 for an unparseable date instead of NaN', () => {
    expect(recencyWeight('not-a-date', FIXTURE_NOW)).toBe(0);
  });
});

describe('repoWeight', () => {
  it('discounts forks and archived repos', () => {
    const fresh = { pushedAt: FIXTURE_NOW.toISOString() };
    expect(repoWeight(makeRepo(fresh), FIXTURE_NOW)).toBe(1);
    expect(repoWeight(makeRepo({ ...fresh, isFork: true }), FIXTURE_NOW)).toBeCloseTo(0.25);
    expect(repoWeight(makeRepo({ ...fresh, isArchived: true }), FIXTURE_NOW)).toBeCloseTo(0.6);
  });
});

describe('deriveEvidence', () => {
  it('is deterministic for the same snapshot and clock', () => {
    const a = deriveEvidence(sampleSnapshot(), FIXTURE_NOW);
    const b = deriveEvidence(sampleSnapshot(), FIXTURE_NOW);
    expect(a).toEqual(b);
  });

  it('never emits a skill without at least one citation', () => {
    const report = deriveEvidence(sampleSnapshot(), FIXTURE_NOW);
    expect(report.skills.length).toBeGreaterThan(0);
    for (const skill of report.skills) {
      expect(skill.citations.length).toBeGreaterThan(0);
    }
  });

  it('cites real file paths for practice skills', () => {
    const report = deriveEvidence(sampleSnapshot(), FIXTURE_NOW);
    const ci = find(report, 'ci-cd');
    expect(ci?.citations.map((c) => c.detail)).toContain('.github/workflows/ci.yml');
    expect(ci?.repoCount).toBe(2);
  });

  it('detects frameworks from manifest dependencies', () => {
    const report = deriveEvidence(sampleSnapshot(), FIXTURE_NOW);
    const next = find(report, 'nextjs');
    expect(next?.citations.some((c) => c.kind === 'dependency' && c.detail.startsWith('next'))).toBe(
      true,
    );
  });

  it('drops skills that only a self-declared topic supports', () => {
    const snapshot = makeSnapshot({
      repos: [makeRepo({ topics: ['react'], filePaths: [], manifests: [] })],
    });
    const report = deriveEvidence(snapshot, FIXTURE_NOW);
    expect(find(report, 'react')).toBeUndefined();
  });

  it('scores a broad, fresh, large language above a narrow stale one', () => {
    const report = deriveEvidence(sampleSnapshot(), FIXTURE_NOW);
    const ts = find(report, 'language:TypeScript');
    const python = find(report, 'language:Python');
    expect(ts).toBeDefined();
    expect(python).toBeDefined();
    expect(ts!.score).toBeGreaterThan(python!.score);
    expect(ts!.confidence).toBe('strong');
    expect(python!.confidence).toBe('weak');
  });

  it('counts merged PRs into other people’s repos, not the user’s own', () => {
    const snapshot = makeSnapshot({
      mergedPullRequests: [
        {
          title: 'External fix',
          url: 'https://github.com/upstream/lib/pull/1',
          repoFullName: 'upstream/lib',
          mergedAtApprox: '2025-12-01T00:00:00.000Z',
        },
        {
          title: 'Own repo change',
          url: 'https://github.com/octo/web-app/pull/2',
          repoFullName: 'octo/web-app',
          mergedAtApprox: '2025-12-01T00:00:00.000Z',
        },
      ],
      mergedPullRequestTotal: 2,
    });
    const report = deriveEvidence(snapshot, FIXTURE_NOW);
    const collab = find(report, 'oss-collaboration');
    expect(collab?.citations).toHaveLength(1);
    expect(collab?.citations[0].repo).toBe('upstream/lib');
  });

  it('reports repos it could not extract any signal from', () => {
    const snapshot = makeSnapshot({
      repos: [makeRepo({ fullName: 'octo/empty' })],
    });
    const report = deriveEvidence(snapshot, FIXTURE_NOW);
    expect(report.unmatchedRepos).toEqual(['octo/empty']);
    expect(report.notes.join(' ')).toContain('no recognised signal');
  });

  it('surfaces truncated file listings as a note so gaps are visible', () => {
    const snapshot = makeSnapshot({
      repos: [makeRepo({ fullName: 'octo/huge', treeTruncated: true, languageBytes: { Go: 10 } })],
    });
    const report = deriveEvidence(snapshot, FIXTURE_NOW);
    expect(report.notes.join(' ')).toContain('truncated');
  });

  it('ranks skills by descending score', () => {
    const report = deriveEvidence(sampleSnapshot(), FIXTURE_NOW);
    const scores = report.skills.map((s) => s.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
});
