import type { AppSession } from './session';
import { env } from '@/lib/env';

export type TokenSource = 'user' | 'server' | 'none';

/**
 * Which GitHub token to use, in priority order.
 *
 * A signed-in user's own token is always preferred: their requests then draw on
 * their own 5,000/hour rather than contending for the server's shared pool. The
 * server token is a single-tenant fallback for local development, and no token
 * at all still works at 60/hour.
 */
export function resolveGitHubToken(session: AppSession | null): {
  token: string | undefined;
  source: TokenSource;
} {
  if (session?.githubToken) return { token: session.githubToken, source: 'user' };

  const serverToken = env().GITHUB_TOKEN;
  if (serverToken) return { token: serverToken, source: 'server' };

  return { token: undefined, source: 'none' };
}
