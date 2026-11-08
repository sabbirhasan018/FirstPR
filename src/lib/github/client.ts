import type { z } from 'zod';
import type { ResponseCache } from './cache';

const DEFAULT_BASE_URL = 'https://api.github.com';

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly isRateLimit: boolean,
    readonly resetAt: Date | null,
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

export type GitHubClient = {
  /** Returns null when GitHub answers 404, so optional resources degrade quietly. */
  get<T>(path: string, schema: z.ZodType<T>, options?: GetOptions): Promise<T | null>;
  /** Request accounting, used to stay inside the rate-limit budget. */
  stats(): ClientStats;
};

export type GetOptions = {
  /**
   * Skip the ETag cache. Needed for endpoints whose whole value is being
   * current — a 304 on /rate_limit would replay a stale budget as if it were
   * live, which is worse than not checking at all.
   */
  bypassCache?: boolean;
};

export type ClientStats = {
  /** Requests sent over the wire. */
  requests: number;
  /** Of those, how many returned 304 and so cost no rate-limit quota. */
  notModified: number;
};

export type GitHubClientOptions = {
  token?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** When supplied, responses are revalidated with ETags instead of refetched. */
  cache?: ResponseCache;
};

export function createGitHubClient(options: GitHubClientOptions = {}): GitHubClient {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch = options.fetchImpl ?? fetch;
  const cache = options.cache;
  let requests = 0;
  let notModified = 0;

  return {
    stats: () => ({ requests, notModified }),

    async get<T>(path: string, schema: z.ZodType<T>, getOptions?: GetOptions): Promise<T | null> {
      requests += 1;
      const useCache = getOptions?.bypassCache ? undefined : cache;

      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'firstpr-evidence-engine',
      };
      if (options.token) headers.Authorization = `Bearer ${options.token}`;

      const cached = await useCache?.get(path);
      if (cached) headers['If-None-Match'] = cached.etag;

      const response = await doFetch(`${baseUrl}${path}`, { headers });

      // 304 means our cached copy is still current, and costs no rate-limit quota.
      if (response.status === 304 && cached) {
        notModified += 1;
        return validate(cached.body, path, schema, 304);
      }

      if (response.status === 404) return null;

      if (!response.ok) {
        const remaining = response.headers.get('x-ratelimit-remaining');
        const reset = response.headers.get('x-ratelimit-reset');
        const isRateLimit =
          (response.status === 403 || response.status === 429) && remaining === '0';
        throw new GitHubApiError(
          isRateLimit
            ? 'GitHub rate limit exhausted.'
            : `GitHub request failed: ${response.status} ${path}`,
          response.status,
          isRateLimit,
          reset ? new Date(Number(reset) * 1000) : null,
        );
      }

      const body = await response.json();

      const etag = response.headers.get('etag');
      if (useCache && etag) {
        await useCache.set(path, { etag, body, storedAt: new Date().toISOString() });
      }

      return validate(body, path, schema, response.status);
    },
  };
}

function validate<T>(body: unknown, path: string, schema: z.ZodType<T>, status: number): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new GitHubApiError(
      `Unexpected GitHub response shape for ${path}: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
      status,
      false,
      null,
    );
  }
  return parsed.data;
}
