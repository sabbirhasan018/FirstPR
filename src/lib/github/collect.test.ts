import { describe, expect, it } from 'vitest';
import { createGitHubClient } from './client';
import { ProfileNotFoundError, collectProfile } from './collect';

const NOW = new Date('2026-01-01T00:00:00.000Z');

const USER = {
  login: 'octo',
  name: 'Octo Cat',
  avatar_url: 'https://avatars.example/1',
  html_url: 'https://github.com/octo',
  bio: null,
  public_repos: 2,
  followers: 5,
  created_at: '2020-01-01T00:00:00.000Z',
};

const REPO = {
  full_name: 'octo/web-app',
  name: 'web-app',
  html_url: 'https://github.com/octo/web-app',
  description: 'demo',
  fork: false,
  archived: false,
  stargazers_count: 3,
  pushed_at: '2025-12-01T00:00:00.000Z',
  created_at: '2024-01-01T00:00:00.000Z',
  default_branch: 'main',
  language: 'TypeScript',
  topics: ['nextjs'],
};

type Route = { body: unknown; status?: number; headers?: Record<string, string> };

/** Minimal fetch stub: matches the first route whose key is a substring of the URL. */
function stubFetch(routes: Record<string, Route>, log: string[] = []) {
  const impl: typeof fetch = async (input) => {
    const url = String(input);
    log.push(url);
    const key = Object.keys(routes).find((candidate) => url.includes(candidate));
    const route = key ? routes[key] : undefined;
    if (!route) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: route.headers,
    });
  };
  return { impl, log };
}

const happyRoutes = (): Record<string, Route> => ({
  '/users/octo/repos': { body: [REPO] },
  '/users/octo': { body: USER },
  '/languages': { body: { TypeScript: 120_000 } },
  '/git/trees/main': {
    body: {
      truncated: false,
      tree: [
        { path: 'package.json', type: 'blob' },
        { path: 'next.config.ts', type: 'blob' },
        { path: 'src', type: 'tree' },
      ],
    },
  },
  '/contents/package.json': {
    body: {
      encoding: 'base64',
      content: Buffer.from(JSON.stringify({ dependencies: { next: '15' } })).toString('base64'),
    },
  },
  '/search/issues': {
    body: {
      total_count: 1,
      items: [
        {
          title: 'Fix parser',
          html_url: 'https://github.com/upstream/lib/pull/9',
          created_at: '2025-11-01T00:00:00.000Z',
          repository_url: 'https://api.github.com/repos/upstream/lib',
        },
      ],
    },
  },
});

describe('collectProfile', () => {
  it('builds a snapshot from user, repo, tree and manifest responses', async () => {
    const { impl } = stubFetch(happyRoutes());
    const snapshot = await collectProfile('octo', createGitHubClient({ fetchImpl: impl }), {
      now: NOW,
    });

    expect(snapshot.login).toBe('octo');
    expect(snapshot.repos).toHaveLength(1);
    expect(snapshot.repos[0].filePaths).toEqual(['package.json', 'next.config.ts']);
    expect(snapshot.repos[0].manifests[0].content).toContain('next');
    expect(snapshot.mergedPullRequests[0].repoFullName).toBe('upstream/lib');
    expect(snapshot.warnings).toEqual([]);
  });

  it('excludes directory entries from the file listing', async () => {
    const { impl } = stubFetch(happyRoutes());
    const snapshot = await collectProfile('octo', createGitHubClient({ fetchImpl: impl }), {
      now: NOW,
    });
    expect(snapshot.repos[0].filePaths).not.toContain('src');
  });

  it('only requests manifests the file tree says exist', async () => {
    const { impl, log } = stubFetch(happyRoutes());
    await collectProfile('octo', createGitHubClient({ fetchImpl: impl }), { now: NOW });
    expect(log.filter((url) => url.includes('/contents/'))).toEqual([
      'https://api.github.com/repos/octo/web-app/contents/package.json',
    ]);
  });

  it('treats an empty repository (409 on the tree) as having no files, not as an error', async () => {
    const routes = happyRoutes();
    routes['/git/trees/main'] = { body: { message: 'Git Repository is empty.' }, status: 409 };
    const { impl } = stubFetch(routes);

    const snapshot = await collectProfile('octo', createGitHubClient({ fetchImpl: impl }), {
      now: NOW,
    });

    expect(snapshot.repos).toHaveLength(1);
    expect(snapshot.repos[0].filePaths).toEqual([]);
    expect(snapshot.warnings).toEqual([]);
  });

  it('throws ProfileNotFoundError for an unknown user', async () => {
    const { impl } = stubFetch({});
    await expect(
      collectProfile('nobody', createGitHubClient({ fetchImpl: impl }), { now: NOW }),
    ).rejects.toBeInstanceOf(ProfileNotFoundError);
  });

  it('degrades to a partial snapshot with a warning when rate limited', async () => {
    const routes = happyRoutes();
    routes['/languages'] = {
      body: { message: 'rate limited' },
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1767225600' },
    };
    const { impl } = stubFetch(routes);

    const snapshot = await collectProfile('octo', createGitHubClient({ fetchImpl: impl }), {
      now: NOW,
    });

    expect(snapshot.repos).toHaveLength(0);
    expect(snapshot.warnings.join(' ')).toContain('rate limit');
    expect(snapshot.warnings.join(' ')).toContain('GITHUB_TOKEN');
  });

  it('keeps the snapshot when only PR search fails', async () => {
    const routes = happyRoutes();
    routes['/search/issues'] = { body: { message: 'boom' }, status: 500 };
    const { impl } = stubFetch(routes);

    const snapshot = await collectProfile('octo', createGitHubClient({ fetchImpl: impl }), {
      now: NOW,
    });

    expect(snapshot.repos).toHaveLength(1);
    expect(snapshot.mergedPullRequestTotal).toBe(0);
    expect(snapshot.warnings.join(' ')).toContain('Merged pull request history unavailable');
  });

  it('warns when repos are skipped because of the deep-scan limit', async () => {
    const routes = happyRoutes();
    routes['/users/octo/repos'] = { body: [REPO, { ...REPO, full_name: 'octo/second' }] };
    const { impl } = stubFetch(routes);

    const snapshot = await collectProfile('octo', createGitHubClient({ fetchImpl: impl }), {
      now: NOW,
      deepScanLimit: 1,
    });

    expect(snapshot.repos).toHaveLength(1);
    expect(snapshot.warnings.join(' ')).toContain('older repos were skipped');
  });
});
