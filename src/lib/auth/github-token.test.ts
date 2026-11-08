import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSession } from './session';

/**
 * `env()` caches on first read, which is right for the app but means the module
 * graph has to be rebuilt between cases here rather than mutating process.env
 * after the fact.
 */
async function resolveWith(serverToken: string | undefined, session: AppSession | null) {
  vi.resetModules();
  if (serverToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = serverToken;

  const { resolveGitHubToken } = await import('./github-token');
  return resolveGitHubToken(session);
}

const session = (githubToken: string | null): AppSession => ({
  userId: 'user-a',
  githubLogin: 'octo',
  displayName: 'Octo',
  avatarUrl: null,
  mode: 'supabase',
  githubToken,
});

beforeEach(() => {
  delete process.env.GITHUB_TOKEN;
});

describe('resolveGitHubToken', () => {
  it('prefers the signed-in user’s own token over the server’s', async () => {
    expect(await resolveWith('server-token', session('user-token'))).toEqual({
      token: 'user-token',
      source: 'user',
    });
  });

  it('falls back to the server token when the user has none', async () => {
    expect(await resolveWith('server-token', session(null))).toEqual({
      token: 'server-token',
      source: 'server',
    });
  });

  it('uses the server token in local mode, where there is no user token', async () => {
    const local: AppSession = { ...session(null), mode: 'local', githubLogin: null };
    expect(await resolveWith('server-token', local)).toEqual({
      token: 'server-token',
      source: 'server',
    });
  });

  it('reports no token rather than throwing when neither exists', async () => {
    expect(await resolveWith(undefined, null)).toEqual({ token: undefined, source: 'none' });
  });
});
