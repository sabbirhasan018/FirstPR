import { z } from 'zod';
import type { GitHubClient } from './client';

/**
 * Rate limit preflight.
 *
 * `/rate_limit` is the one endpoint that does not count against the rate limit,
 * so checking the budget before spending it is free. Discovering mid-run that
 * there was never enough quota is the worst possible time to find out.
 */

const rateLimitSchema = z.object({
  resources: z.object({
    core: z.object({
      limit: z.number(),
      remaining: z.number(),
      reset: z.number(),
    }),
    search: z.object({
      limit: z.number(),
      remaining: z.number(),
      reset: z.number(),
    }),
  }),
});

export type RateLimitStatus = {
  coreRemaining: number;
  coreLimit: number;
  coreResetAt: Date;
  searchRemaining: number;
  /** True when the limit is the anonymous tier, i.e. no token is configured. */
  anonymous: boolean;
};

export async function checkRateLimit(client: GitHubClient): Promise<RateLimitStatus | null> {
  const data = await client.get('/rate_limit', rateLimitSchema, { bypassCache: true });
  if (!data) return null;

  const { core, search } = data.resources;
  return {
    coreRemaining: core.remaining,
    coreLimit: core.limit,
    coreResetAt: new Date(core.reset * 1000),
    searchRemaining: search.remaining,
    anonymous: core.limit <= 60,
  };
}

/** Advice text shown whenever the budget is the thing limiting the result. */
export function tokenAdvice(status: RateLimitStatus): string {
  return status.anonymous
    ? 'You are using GitHub anonymously, which allows 60 requests an hour. Setting GITHUB_TOKEN in .env.local raises that to 5,000.'
    : 'Your token’s hourly budget is running low.';
}

export function describeReset(status: RateLimitStatus): string {
  const minutes = Math.max(
    0,
    Math.round((status.coreResetAt.getTime() - Date.now()) / 60_000),
  );
  if (minutes === 0) return 'the limit resets in under a minute';
  return `the limit resets in about ${minutes} minute${minutes === 1 ? '' : 's'}`;
}
