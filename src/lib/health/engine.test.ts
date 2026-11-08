import { describe, expect, it } from 'vitest';
import { scoreRepoHealth } from './engine';
import { HEALTH_NOW, healthyRepo, makeHealthSnapshot, neglectedRepo } from './fixtures';

const signal = (health: ReturnType<typeof scoreRepoHealth>, id: string) =>
  health.signals.find((s) => s.id === id)!;

describe('scoreRepoHealth', () => {
  it('is deterministic for the same snapshot and clock', () => {
    expect(scoreRepoHealth(healthyRepo(), HEALTH_NOW)).toEqual(
      scoreRepoHealth(healthyRepo(), HEALTH_NOW),
    );
  });

  it('separates a well-run repo from a neglected one', () => {
    const healthy = scoreRepoHealth(healthyRepo(), HEALTH_NOW);
    const neglected = scoreRepoHealth(neglectedRepo(), HEALTH_NOW);

    expect(healthy.band).toBe('healthy');
    expect(neglected.band).toBe('risky');
    expect(healthy.survivalScore!).toBeGreaterThan(neglected.survivalScore!);
  });

  it('withholds a score when too little was observable', () => {
    const health = scoreRepoHealth(makeHealthSnapshot(), HEALTH_NOW);

    expect(health.survivalScore).toBeNull();
    expect(health.band).toBe('insufficient-data');
    expect(health.summary).toContain('Not enough was readable');
  });

  it('treats unavailable data as absent, not as a zero score', () => {
    const base = healthyRepo();
    const withoutCi = scoreRepoHealth({ ...base, workflowRuns: [] }, HEALTH_NOW);
    const withFailingCi = scoreRepoHealth(
      {
        ...base,
        workflowRuns: Array.from({ length: 10 }, () => ({
          conclusion: 'failure',
          createdAt: HEALTH_NOW.toISOString(),
        })),
      },
      HEALTH_NOW,
    );

    expect(signal(withoutCi, 'ci-health').value).toBeNull();
    expect(signal(withFailingCi, 'ci-health').value).toBe(0);
    // Missing CI must not be penalised the way broken CI is.
    expect(withoutCi.survivalScore!).toBeGreaterThan(withFailingCi.survivalScore!);
  });

  it('reports coverage so a partially-read repo is visibly partial', () => {
    const full = scoreRepoHealth(healthyRepo(), HEALTH_NOW);
    const partial = scoreRepoHealth(
      { ...healthyRepo(), workflowRuns: [], latestReleaseAt: null },
      HEALTH_NOW,
    );

    expect(full.coverage).toBe(1);
    expect(partial.coverage).toBeLessThan(1);
    expect(partial.summary).toContain('not a merge probability');
  });

  it('marks an archived repo risky however good its other signals are', () => {
    const health = scoreRepoHealth({ ...healthyRepo(), isArchived: true }, HEALTH_NOW);

    expect(health.band).toBe('risky');
    expect(health.summary).toContain('accepts no contributions');
  });

  it('shrinks a perfect merge ratio drawn from a tiny sample', () => {
    const twoPrs = scoreRepoHealth(
      {
        ...healthyRepo(),
        closedPullRequests: [
          { createdAt: '2025-12-01T00:00:00Z', updatedAt: '2025-12-02T00:00:00Z', mergedAt: '2025-12-02T00:00:00Z' },
          { createdAt: '2025-12-03T00:00:00Z', updatedAt: '2025-12-04T00:00:00Z', mergedAt: '2025-12-04T00:00:00Z' },
        ],
      },
      HEALTH_NOW,
    );
    const manyPrs = scoreRepoHealth(healthyRepo(), HEALTH_NOW);

    expect(signal(twoPrs, 'merge-activity').value).toBeLessThan(1);
    expect(signal(twoPrs, 'merge-activity').value!).toBeLessThan(
      signal(manyPrs, 'merge-activity').value!,
    );
  });

  it('counts stale open pull requests against freshness', () => {
    const health = scoreRepoHealth(
      {
        ...healthyRepo(),
        openPullRequests: [
          { createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z', mergedAt: null },
          { createdAt: '2025-12-20T00:00:00Z', updatedAt: '2025-12-28T00:00:00Z', mergedAt: null },
        ],
      },
      HEALTH_NOW,
    );

    expect(signal(health, 'open-pr-freshness').value).toBe(0.5);
    expect(signal(health, 'open-pr-freshness').detail).toContain('1 of 2');
  });

  it('never presents the score as a merge probability', () => {
    const health = scoreRepoHealth(healthyRepo(), HEALTH_NOW);
    expect(health.summary).toContain('not a merge probability');
  });

  it('gives every signal a human-readable detail line', () => {
    const health = scoreRepoHealth(healthyRepo(), HEALTH_NOW);
    for (const s of health.signals) {
      expect(s.detail.length).toBeGreaterThan(0);
    }
  });
});
