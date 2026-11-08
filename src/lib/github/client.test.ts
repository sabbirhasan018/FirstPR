import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMemoryCache } from './cache';
import { createGitHubClient, GitHubApiError } from './client';

const schema = z.object({ value: z.string() });

/** Serves a body with an ETag, answering 304 when the client revalidates. */
function etagServer(body: unknown, etag = 'W/"abc"') {
  const seen: (string | null)[] = [];
  const impl: typeof fetch = async (_input, init) => {
    const ifNoneMatch = new Headers(init?.headers).get('If-None-Match');
    seen.push(ifNoneMatch);
    if (ifNoneMatch === etag) return new Response(null, { status: 304 });
    return new Response(JSON.stringify(body), { headers: { etag } });
  };
  return { impl, seen };
}

describe('createGitHubClient caching', () => {
  it('revalidates with If-None-Match and reuses the cached body on 304', async () => {
    const { impl, seen } = etagServer({ value: 'hello' });
    const client = createGitHubClient({ fetchImpl: impl, cache: createMemoryCache() });

    expect(await client.get('/thing', schema)).toEqual({ value: 'hello' });
    expect(await client.get('/thing', schema)).toEqual({ value: 'hello' });

    expect(seen).toEqual([null, 'W/"abc"']);
    expect(client.stats()).toEqual({ requests: 2, notModified: 1 });
  });

  it('refetches when the ETag changed', async () => {
    let etag = 'W/"v1"';
    let value = 'first';
    const impl: typeof fetch = async (_input, init) => {
      if (new Headers(init?.headers).get('If-None-Match') === etag) {
        return new Response(null, { status: 304 });
      }
      return new Response(JSON.stringify({ value }), { headers: { etag } });
    };
    const client = createGitHubClient({ fetchImpl: impl, cache: createMemoryCache() });

    expect(await client.get('/thing', schema)).toEqual({ value: 'first' });
    etag = 'W/"v2"';
    value = 'second';
    expect(await client.get('/thing', schema)).toEqual({ value: 'second' });
    expect(client.stats().notModified).toBe(0);
  });

  it('keys the cache per path so one entry cannot serve another', async () => {
    const impl: typeof fetch = async (input) =>
      new Response(JSON.stringify({ value: String(input) }), { headers: { etag: 'W/"same"' } });
    const client = createGitHubClient({ fetchImpl: impl, cache: createMemoryCache() });

    const a = await client.get('/a', schema);
    const b = await client.get('/b', schema);
    expect(a).not.toEqual(b);
  });

  it('works without a cache, sending no conditional header', async () => {
    const { impl, seen } = etagServer({ value: 'hello' });
    const client = createGitHubClient({ fetchImpl: impl });

    await client.get('/thing', schema);
    await client.get('/thing', schema);
    expect(seen).toEqual([null, null]);
    expect(client.stats()).toEqual({ requests: 2, notModified: 0 });
  });

  it('does not cache a response GitHub sent without an ETag', async () => {
    const impl: typeof fetch = async () => new Response(JSON.stringify({ value: 'x' }));
    const cache = createMemoryCache();
    const client = createGitHubClient({ fetchImpl: impl, cache });

    await client.get('/thing', schema);
    expect(cache.size()).toBe(0);
  });

  it('still validates a body served from cache', async () => {
    const cache = createMemoryCache();
    await cache.set('/thing', { etag: 'W/"abc"', body: { wrong: 1 }, storedAt: 'now' });
    const { impl } = etagServer({ value: 'hello' });
    const client = createGitHubClient({ fetchImpl: impl, cache });

    await expect(client.get('/thing', schema)).rejects.toBeInstanceOf(GitHubApiError);
  });
});

describe('createMemoryCache', () => {
  it('evicts the least recently used entry past its bound', async () => {
    const cache = createMemoryCache(2);
    await cache.set('a', { etag: '1', body: {}, storedAt: 'now' });
    await cache.set('b', { etag: '2', body: {}, storedAt: 'now' });
    await cache.get('a'); // 'a' is now the most recently used
    await cache.set('c', { etag: '3', body: {}, storedAt: 'now' });

    expect(cache.size()).toBe(2);
    expect(await cache.get('b')).toBeUndefined();
    expect(await cache.get('a')).toBeDefined();
  });
});
