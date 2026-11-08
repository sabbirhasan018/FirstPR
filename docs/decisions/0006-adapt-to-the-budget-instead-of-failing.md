# ADR 0006 — Adapt to the rate-limit budget instead of failing

- **Status:** accepted
- **Date:** 2026-08-18

## Context

Anonymous GitHub access allows 60 core requests an hour. A profile import costs
roughly 30 and a discovery run roughly 35, so an unauthenticated user got about
one action per hour and frequently watched a run die halfway through with
"rate limit exhausted". That is not a usable product, and "set a token" is not an
acceptable answer to *why the app is unusable out of the box*.

Note that GitHub's GraphQL API — the obvious way to collapse seven REST calls
into one — **rejects unauthenticated requests entirely**, so it cannot help the
users who need help most.

## Decision

Three changes, none of which require a credential.

1. **Preflight the budget.** `/rate_limit` does not count against the rate limit,
   so it is checked before every discovery run. An empty budget fails
   immediately, with the reset time, having spent nothing.
2. **Scale the budget to what exists.** A run spends at most half the remaining
   quota, capped at 400 requests. Anonymously that is ~30; with a token it is
   enough to scan every candidate repository at full depth. One click can never
   leave the user with nothing for an hour.
3. **Trade depth for breadth when quota is scarce.** A full repo scan costs 7
   requests. The three highest-weight signals — maintainer activity, merge
   activity, issue responsiveness — cost 3 and carry 0.65 of the total weight,
   clearing the scorer's 0.5 coverage floor. When a full scan cannot reach every
   candidate repo, an essential scan is used instead.

The third point works only because of [ADR 0004](0004-withhold-a-score-rather-than-guess.md):
missing signals already drop out of the denominator and `coverage` is already
reported per repo. A cheap scan reads as *less complete*, never as *worse*.

## Consequences

**Good:**

- Roughly 2.5× more repositories scored on the same anonymous budget, because an
  unscored repo contributes nothing to ranking while an essentially-scored one
  contributes most of the signal.
- Failures happen before any quota is spent, with a reset time attached.
- The same code path gets better rather than different when a token appears.

**Bad:**

- Scores are no longer directly comparable between runs, since coverage varies.
  This is visible rather than hidden — every repo reports its own coverage.
- Two scan depths means two paths to keep correct.

## Still the real fix

This makes anonymous use tolerable, not good. Per-user GitHub OAuth, so every
signed-in user brings their own 5,000/hour, remains the correct answer and is
scheduled for Phase 2 alongside Supabase auth.
