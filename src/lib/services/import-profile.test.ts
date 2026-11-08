import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '@/lib/store/memory';
import { githubLoginSchema, importProfile } from './import-profile';

const NOW = new Date('2026-01-01T00:00:00.000Z');

const USER = {
  login: 'octo',
  name: 'Octo Cat',
  avatar_url: 'https://avatars.example/1',
  html_url: 'https://github.com/octo',
  bio: null,
  public_repos: 1,
  followers: 0,
  created_at: '2020-01-01T00:00:00.000Z',
};

const REPO = {
  full_name: 'octo/web-app',
  name: 'web-app',
  html_url: 'https://github.com/octo/web-app',
  description: null,
  fork: false,
  archived: false,
  stargazers_count: 0,
  pushed_at: '2025-12-01T00:00:00.000Z',
  created_at: '2024-01-01T00:00:00.000Z',
  default_branch: 'main',
  language: 'TypeScript',
  topics: [],
};

const okFetch: typeof fetch = async (input) => {
  const url = String(input);
  const json = (body: unknown) => new Response(JSON.stringify(body));

  if (url.includes('/users/octo/repos')) return json([REPO]);
  if (url.includes('/users/octo')) return json(USER);
  if (url.includes('/languages')) return json({ TypeScript: 150_000 });
  if (url.includes('/git/trees/')) {
    return json({
      truncated: false,
      tree: [{ path: '.github/workflows/ci.yml', type: 'blob' }],
    });
  }
  if (url.includes('/search/issues')) return json({ total_count: 0, items: [] });
  return new Response('{}', { status: 404 });
};

describe('githubLoginSchema', () => {
  it.each(['octo', 'a', 'a-b-c', 'Octo-Cat-99'])('accepts %s', (login) => {
    expect(githubLoginSchema.safeParse(login).success).toBe(true);
  });

  it.each(['', '-lead', 'trail-', 'double--hyphen', 'has space', 'has/slash', 'a'.repeat(40)])(
    'rejects %s',
    (login) => {
      expect(githubLoginSchema.safeParse(login).success).toBe(false);
    },
  );
});

describe('importProfile', () => {
  it('collects, derives and persists in one call', async () => {
    const store = createMemoryStore();
    const result = await importProfile('octo', {
      store,
      userId: 'user-a',
      fetchImpl: okFetch,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.githubLogin).toBe('octo');
    expect(result.record.report.skills.some((s) => s.skillId === 'ci-cd')).toBe(true);
    expect((await store.latestImport('user-a'))?.id).toBe(result.record.id);
  });

  it('rejects an invalid username before making any request', async () => {
    let called = false;
    const result = await importProfile('not a name', {
      store: createMemoryStore(),
      userId: 'user-a',
      fetchImpl: async () => {
        called = true;
        return new Response('{}');
      },
    });

    expect(result).toEqual({ ok: false, error: 'That is not a valid GitHub username.' });
    expect(called).toBe(false);
  });

  it('reports an unknown user without persisting anything', async () => {
    const store = createMemoryStore();
    const result = await importProfile('ghost', {
      store,
      userId: 'user-a',
      fetchImpl: async () => new Response('{}', { status: 404 }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('was not found');
    expect(await store.latestImport('user-a')).toBeNull();
  });

  it('explains the rate limit and points at GITHUB_TOKEN', async () => {
    const result = await importProfile('octo', {
      store: createMemoryStore(),
      userId: 'user-a',
      fetchImpl: async () =>
        new Response('{}', {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0' },
        }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('GITHUB_TOKEN');
  });
});
