# ADR 0005 — Conditional requests, not a TTL cache

- **Status:** accepted
- **Date:** 2026-08-18

## Context

GitHub allows 60 requests per hour unauthenticated and 5,000 authenticated. A
single issue-discovery run costs roughly 35. Rate limit, not latency, is the
binding constraint on this product — without a strategy, a user gets fewer than
two discovery runs per hour.

The usual answer is a time-to-live cache: store responses for N minutes and skip
the request entirely. That forces a choice between stale rankings (long TTL) and
no savings (short TTL), and the right N differs per endpoint — a repo's file tree
changes far less often than its open pull requests.

## Decision

Cache on GitHub's own validators instead. Every response carries an ETag; it is
stored, replayed as `If-None-Match`, and a `304 Not Modified` reuses the cached
body.

The key property: **a 304 does not count against the rate limit.** So a repeat
run costs almost no quota while still returning current data, and there is no TTL
to tune.

The cache is LRU-bounded and in-memory, keyed by request path.

## Consequences

**Good:**

- No staleness/savings tradeoff. A 304 means the data genuinely has not changed.
- No per-endpoint TTL tuning.
- The savings are measurable, and a test asserts a second identical discovery run
  spends zero fresh quota.
- `stats()` reports requests and 304s, so the budget is observable rather than
  guessed at.

**Bad:**

- Every request is still a round trip, so this saves quota, not latency.
- In-memory means the cache dies with the process, and each server instance keeps
  its own. A shared cache would be strictly better under load.
- Responses GitHub sends without an ETag are simply not cached.

**Accepted** because quota is the constraint that actually blocks users today.
Persisting the cache is in [BACKLOG.md](../BACKLOG.md); it is a change of
storage, not of strategy.
