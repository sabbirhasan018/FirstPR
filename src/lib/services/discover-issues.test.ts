import { describe, expect, it } from 'vitest';
import { createGitHubClient } from '@/lib/github/client';
import { createMemoryCache } from '@/lib/github/cache';
import { ISSUES_NOW, sampleEvidence } from '@/lib/issues/fixtures';
import { discoverIssues } from './discover-issues';

const iso = (daysAgo: number) =>
  new Date(ISSUES_NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();

function searchItem(id: number, repo: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    number: id,
    title: `Issue ${id}`,
    html_url: `https://github.com/${repo}/issues/${id}`,
    repository_url: `https://api.github.com/repos/${repo}`,
    labels: [],
    created_at: iso(30),
    updated_at: iso(3),
    comments: 2,
    assignee: null,
    assignees: [],
    body: 'x'.repeat(900),
    state: 'open',
    ...overrides,
  };
}

type Options = {
  searchItems?: ReturnType<typeof searchItem>[];
  archived?: boolean;
  failCi?: boolean;
  /** Core requests GitHub says are left, as reported by the free preflight. */
  coreRemaining?: number;
  coreLimit?: number;
};

/** Stub GitHub covering search plus every repo-health endpoint. */
function stubGitHub(options: Options = {}) {
  const log: string[] = [];
  const items = options.searchItems ?? [searchItem(1, 'acme/widget'), searchItem(2, 'acme/widget')];

  const impl: typeof fetch = async (input, init) => {
    const url = String(input);
    log.push(url);
    const etag = `W/"${url.length}"`;

    // Behave like GitHub: a matching validator gets a 304, which costs no quota.
    if (new Headers(init?.headers).get('If-None-Match') === etag) {
      return new Response(null, { status: 304 });
    }

    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { etag } });

    if (url.includes('/rate_limit')) {
      const reset = Math.floor(ISSUES_NOW.getTime() / 1000) + 3600;
      const core = {
        limit: options.coreLimit ?? 5000,
        remaining: options.coreRemaining ?? 5000,
        reset,
      };
      return json({ resources: { core, search: { limit: 30, remaining: 30, reset } } });
    }
    if (url.includes('/search/issues')) {
      return json({ total_count: items.length, incomplete_results: false, items });
    }
    if (url.includes('/community/profile')) {
      return json({ files: { contributing: { url: 'x' }, issue_template: null } });
    }
    if (url.includes('/actions/runs')) {
      if (options.failCi) return new Response('{}', { status: 500 });
      return json({
        workflow_runs: Array.from({ length: 8 }, (_, i) => ({
          conclusion: i < 7 ? 'success' : 'failure',
          created_at: iso(i),
        })),
      });
    }
    if (url.includes('/releases/latest')) return json({ published_at: iso(30) });
    if (url.includes('/pulls?state=closed')) {
      return json(
        Array.from({ length: 12 }, (_, i) => ({
          created_at: iso(40 + i),
          updated_at: iso(10 + i),
          merged_at: i < 10 ? iso(10 + i) : null,
        })),
      );
    }
    if (url.includes('/pulls?state=open')) {
      return json([{ created_at: iso(20), updated_at: iso(4), merged_at: null }]);
    }
    if (url.includes('/issues?state=all')) {
      return json([
        { created_at: iso(10), closed_at: iso(5), comments: 3 },
        { created_at: iso(12), closed_at: null, comments: 1 },
        // A pull request masquerading as an issue on this endpoint.
        { created_at: iso(9), closed_at: null, comments: 0, pull_request: { url: 'x' } },
      ]);
    }
    const repoMatch = /\/repos\/([^/]+\/[^/?]+)$/.exec(url);
    if (repoMatch) {
      const fullName = repoMatch[1];
      return json({
        full_name: fullName,
        html_url: `https://github.com/${fullName}`,
        description: 'a widget',
        stargazers_count: 400,
        archived: options.archived ?? false,
        fork: false,
        pushed_at: iso(2),
        created_at: iso(900),
        open_issues_count: 20,
        language: 'TypeScript',
        topics: ['react'],
        license: { spdx_id: 'MIT' },
      });
    }
    return new Response('{}', { status: 404 });
  };

  return { impl, log };
}

const run = (options: Options = {}, extra: Partial<Parameters<typeof discoverIssues>[0]> = {}) => {
  const { impl, log } = stubGitHub(options);
  return {
    log,
    result: discoverIssues({
      evidence: sampleEvidence(),
      client: createGitHubClient({ fetchImpl: impl, cache: createMemoryCache() }),
      now: ISSUES_NOW,
      ...extra,
    }),
  };
};

describe('discoverIssues', () => {
  it('searches, scores repo health and returns explained rankings', async () => {
    const result = await run().result;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ranking.ranked.length).toBeGreaterThan(0);
    expect(result.ranking.ranked[0].reasons.length).toBeGreaterThan(0);
    expect(result.health[0].survivalScore).not.toBeNull();
  });

  it('searches only the languages the user has real evidence in', async () => {
    const { log, result } = run();
    await result;

    const searches = log.filter((url) => url.includes('/search/issues'));
    expect(searches).toHaveLength(2);
    expect(searches.join(' ')).toContain('TypeScript');
    expect(searches.join(' ')).toContain('Python');
    // Python scores 30, above the floor; React is not a language and is not searched.
    expect(searches.join(' ')).not.toContain('React');
  });

  it('does not filter the search by "good first issue"', async () => {
    const { log, result } = run();
    await result;

    expect(log.filter((u) => u.includes('/search/issues')).join(' ')).not.toContain('good+first');
  });

  it('excludes pull requests from the issue responsiveness signal', async () => {
    const result = await run().result;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const responsiveness = result.health[0].signals.find((s) => s.id === 'issue-responsiveness');
    expect(responsiveness?.detail).toContain('last 2 issues');
  });

  it('keeps scoring when one health endpoint fails, marking that signal absent', async () => {
    const result = await run({ failCi: true }).result;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ci = result.health[0].signals.find((s) => s.id === 'ci-health');
    expect(ci?.value).toBeNull();
    expect(result.health[0].survivalScore).not.toBeNull();
    expect(result.health[0].coverage).toBeLessThan(1);
  });

  it('excludes every issue from an archived repository', async () => {
    const result = await run({ archived: true }).result;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ranking.ranked).toHaveLength(0);
    expect(result.ranking.excluded.every((e) => e.reason.includes('archived'))).toBe(true);
  });

  it('respects the request budget and says which repos went unscored', async () => {
    const items = Array.from({ length: 6 }, (_, i) => searchItem(i + 1, `acme/repo${i}`));
    const result = await run({ searchItems: items }, { healthRequestBudget: 7 }).result;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 7 requests buys two essential scans (3 each), not one full scan (7).
    expect(result.health).toHaveLength(2);
    expect(result.ranking.notes.join(' ')).toContain('went unscored');
  });

  it('trades scan depth for breadth when the budget cannot cover every repo', async () => {
    const items = Array.from({ length: 5 }, (_, i) => searchItem(i + 1, `acme/repo${i}`));
    const result = await run({ searchItems: items }, { healthRequestBudget: 21 }).result;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A full scan of 21 requests covers 3 repos; an essential scan covers all 5.
    expect(result.health).toHaveLength(5);
    for (const repo of result.health) {
      expect(repo.survivalScore).not.toBeNull();
      expect(repo.coverage).toBeCloseTo(0.65, 2);
    }
    expect(result.ranking.notes.join(' ')).toContain('three highest-weight signals');
  });

  it('scans fully when the budget comfortably covers every repo', async () => {
    const result = await run({ searchItems: [searchItem(1, 'acme/widget')] }).result;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.health[0].coverage).toBe(1);
  });

  it('spends only part of a scarce budget, leaving the user something left', async () => {
    const items = Array.from({ length: 6 }, (_, i) => searchItem(i + 1, `acme/repo${i}`));
    const result = await run({ searchItems: items, coreRemaining: 6, coreLimit: 60 }).result;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Half of 6 buys one essential scan; the rest of the quota stays available.
    expect(result.health).toHaveLength(1);
    expect(result.ranking.notes.join(' ')).toContain('6 of 60 requests');
    expect(result.ranking.notes.join(' ')).toContain('GITHUB_TOKEN');
  });

  it('scales the budget up when a token makes quota plentiful', async () => {
    const items = Array.from({ length: 12 }, (_, i) => searchItem(i + 1, `acme/repo${i}`));
    const result = await run({ searchItems: items, coreRemaining: 5000, coreLimit: 5000 }).result;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Plentiful quota affords a full-depth scan of every candidate repo.
    expect(result.health).toHaveLength(12);
    expect(result.health.every((repo) => repo.coverage === 1)).toBe(true);
    expect(result.ranking.notes.join(' ')).not.toContain('GITHUB_TOKEN');
  });

  it('refuses up front, without spending anything, when the budget is empty', async () => {
    const { log, result } = run({ coreRemaining: 0, coreLimit: 60 });
    const outcome = await result;

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toContain('No GitHub requests left');
    expect(outcome.error).toContain('GITHUB_TOKEN');
    expect(log.filter((url) => url.includes('/search/issues'))).toHaveLength(0);
  });

  it('still ranks when the rate limit runs out partway through scoring repos', async () => {
    const items = Array.from({ length: 4 }, (_, i) => searchItem(i + 1, `acme/repo${i}`));
    const { impl } = stubGitHub({ searchItems: items });

    // One repo scans cleanly; every other repo is out of quota. Expressed per
    // repo rather than per request count so the result does not depend on how
    // many scans run concurrently.
    const limited: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/repos/') && !url.includes('acme/repo0')) {
        return new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
      }
      return impl(input, init);
    };

    const result = await discoverIssues({
      evidence: sampleEvidence(),
      client: createGitHubClient({ fetchImpl: limited }),
      now: ISSUES_NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ranking.ranked).toHaveLength(4);
    expect(result.health).toHaveLength(1);
    expect(result.ranking.notes.join(' ')).toContain('rate limit ran out partway');
  });

  it('refuses to search when no language has enough evidence', async () => {
    const result = await run(
      {},
      { evidence: { ...sampleEvidence(), skills: [] } },
    ).result;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('No language has enough evidence');
  });

  it('reports the rate limit with the fix rather than failing opaquely', async () => {
    const impl: typeof fetch = async () =>
      new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } });

    const result = await discoverIssues({
      evidence: sampleEvidence(),
      client: createGitHubClient({ fetchImpl: impl }),
      now: ISSUES_NOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('GITHUB_TOKEN');
  });

  it('spends no extra rate limit on a second identical run', async () => {
    const { impl } = stubGitHub();
    const cache = createMemoryCache();
    const client = createGitHubClient({ fetchImpl: impl, cache });

    await discoverIssues({ evidence: sampleEvidence(), client, now: ISSUES_NOW });
    const afterFirst = client.stats();
    await discoverIssues({ evidence: sampleEvidence(), client, now: ISSUES_NOW });
    const afterSecond = client.stats();

    const secondRunRequests = afterSecond.requests - afterFirst.requests;
    const secondRunFree = afterSecond.notModified - afterFirst.notModified;
    // Everything is revalidated except the preflight, which deliberately
    // bypasses the cache so it can never report a stale budget.
    expect(secondRunFree).toBe(secondRunRequests - 1);
  });
});
