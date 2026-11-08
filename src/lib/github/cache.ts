/**
 * Conditional-request cache for the GitHub REST API.
 *
 * GitHub returns an ETag on every response. Re-sending it as `If-None-Match`
 * yields a 304 when nothing changed — and a 304 does not count against the
 * hourly rate limit. That is the whole point: rate limit, not latency, is the
 * scarce resource in this application.
 */

export type CacheEntry = {
  etag: string;
  body: unknown;
  storedAt: string;
};

export type ResponseCache = {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
  size(): number;
};

const DEFAULT_MAX_ENTRIES = 500;

/**
 * Bounded in-memory cache with least-recently-used eviction. A Map preserves
 * insertion order, so re-inserting on read is enough to track recency.
 */
export function createMemoryCache(maxEntries = DEFAULT_MAX_ENTRIES): ResponseCache {
  const entries = new Map<string, CacheEntry>();

  return {
    async get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return entry;
    },

    async set(key, entry) {
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },

    size: () => entries.size,
  };
}

const globalForCache = globalThis as unknown as { __firstprResponseCache?: ResponseCache };

/** Process-wide cache, stashed on globalThis to survive Next.js hot reloads. */
export function sharedResponseCache(): ResponseCache {
  globalForCache.__firstprResponseCache ??= createMemoryCache();
  return globalForCache.__firstprResponseCache;
}
