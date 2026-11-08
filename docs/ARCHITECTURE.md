# Architecture

## Shape of the system

FirstPR is a Next.js App Router application where all meaningful logic lives in
plain TypeScript modules under `src/lib`, not in React components. The UI is a
thin rendering layer over a pure core.

```
 Browser
    │  form submit (server action)
    ▼
 src/app/actions.ts ────────────► src/lib/services/import-profile.ts
 src/app/issues/actions.ts ─────► src/lib/services/discover-issues.ts
                                          │
                      ┌───────────────────┼───────────────────┐
                      ▼                   ▼                   ▼
             lib/github/client.ts   pure engines            lib/store
             lib/github/collect.ts    evidence/engine.ts    (interface)
             lib/github/cache.ts      health/engine.ts         │
             lib/health/collect.ts    issues/matcher.ts        │
             lib/issues/collect.ts                             │
                      │                                ┌───────┴────────┐
                      ▼                           memory.ts      supabase.ts
              api.github.com                      (local mode)   (Postgres+RLS)
```

Three pure engines sit behind the same wall. `evidence/engine.ts` turns observed
repo artefacts into skills; `health/engine.ts` turns observed maintenance
behaviour into a survival score; `issues/matcher.ts` combines both to order a
list of issues. None of them performs I/O, and each takes its clock as an
argument.

## Layer rules

1. **`lib/evidence` is pure.** It takes a `ProfileSnapshot` and a `Date` and
   returns an `EvidenceReport`. It performs no I/O, reads no environment, and
   never calls `new Date()` implicitly. This is what makes scoring testable and
   reproducible.
2. **`lib/github` owns the network boundary.** Every response is parsed with a
   Zod schema before it becomes a typed value. Nothing downstream trusts the
   API's shape.
3. **`lib/store` is an interface, not a database.** Two implementations satisfy
   `EvidenceStore`. The rest of the app cannot tell which is active.
4. **`src/app` orchestrates and renders.** It resolves the session, picks a
   store, calls a service, and displays the result.

## Why the collector is shaped this way

A naive collector would fetch each interesting file separately and exhaust the
rate limit immediately. Instead, per repository:

| Request | Cost | Yield |
| --- | --- | --- |
| `/languages` | 1 | every language, by bytes |
| `/git/trees/{branch}?recursive=1` | 1 | the entire file listing |
| `/contents/{manifest}` | 0–2 | only manifests the tree proved exist |

That is 2–4 requests per repo instead of dozens. The deep-scan limit
(`DEFAULT_DEEP_SCAN_LIMIT = 12`) keeps a full import under ~40 requests, so it
fits inside the unauthenticated hourly budget of 60.

Partial failure is normal and is modelled, not thrown away: a rate limit stops
the scan and records a warning; a per-repo error is recorded and the scan
continues; a 409 (empty repository) is read as "no files", because it is a fact
about the repo rather than a failure.

## Scoring model

```
score = round(100 × (0.40 × breadth + 0.35 × freshness + 0.25 × depth))
```

| Component | Languages | Everything else |
| --- | --- | --- |
| breadth | `min(1, Σ repoWeight / 3)` | same |
| freshness | `max(repoWeight)` | same |
| depth | `log10(1+bytes) / log10(1+200 000)` | `min(1, distinctArtefacts / 4)` |

where `repoWeight = 0.5^(monthsSincePush/18) × (fork ? 0.25 : 1) × (archived ? 0.6 : 1)`.

Confidence bands: `strong ≥ 65`, `moderate ≥ 35`, otherwise `weak`.

The constants are opinions, and they are named constants at the top of
`engine.ts` precisely so they can be argued with and changed. The engine's
guarantee is not that the weights are correct — it is that they are *fixed,
visible and applied identically to everyone*.

## Rate limit as the primary constraint

Unauthenticated callers get 60 requests per hour; one discovery run costs about
35. Three mechanisms keep this workable:

1. **Conditional requests.** Every response's ETag is stored and replayed as
   `If-None-Match`. A `304` reuses the cached body and does not count against the
   limit, so repeat runs are nearly free ([ADR 0005](decisions/0005-conditional-requests-as-the-rate-limit-strategy.md)).
2. **A request budget.** `discoverIssues` computes how many repos it can afford
   at `REQUESTS_PER_REPO` each, scores the most-represented ones first, and
   reports the rest as unscored rather than pretending they were considered.
3. **Persistence.** Runs are written to the database and re-read, so viewing the
   page costs nothing.

## Repo Survival Score

Seven signals, each 0–1, combined as a weighted mean *over the signals that were
actually observable*:

| Signal | Weight | Source |
| --- | --- | --- |
| Maintainer activity | 0.25 | last push, 3-month half-life |
| Merge activity | 0.25 | merged fraction of last 20 closed PRs |
| Issue responsiveness | 0.15 | fraction of recent issues with a reply |
| CI health | 0.10 | pass rate of last 20 workflow runs |
| Release cadence | 0.10 | latest release, 9-month half-life |
| Open PR freshness | 0.10 | fraction untouched over 90 days |
| Contributor docs | 0.05 | community profile |

A missing signal's weight is removed from the denominator rather than scored as
zero, and below 50% coverage no score is emitted at all
([ADR 0004](decisions/0004-withhold-a-score-rather-than-guess.md)). Merge
ratios from small samples are shrunk toward zero, so two-for-two does not outrank
thirty-for-thirty.

## Issue ranking

```
score = 100 × (0.40 × skillMatch + 0.30 × repoHealth + 0.20 × approachability + 0.10 × specification)
```

Hard exclusions run first — assigned issues, archived repos, and labels like
`blocked`, `duplicate` or `wontfix` — and the excluded set is displayed rather
than discarded. An unscored repo contributes a neutral 0.5, because unknown is
not the same as bad.

The search deliberately does **not** filter on `good first issue`. That filter is
the baseline this ranking has to beat, and it drops the many workable issues
maintainers never label. `matcher.test.ts` holds the comparison as an executable
test: precision@3 of 1.00 against the baseline's 0.33 on a benchmark set with
known ground truth. If that inverts, the roadmap says delete the ranking.

## Data model

Four tables, all with owner-only row level security (`supabase/migrations/0001_init.sql`).

```
auth.users
    │ 1:1 (trigger on insert)
    ▼
profiles ──1:N──► evidence_snapshots ──1:N──► skill_evidence ──1:N──► evidence_citations
    │
    └───1:N──► discovery_runs ──┬──1:N──► repo_health
                                └──1:N──► ranked_issues
```

Design decisions worth naming:

- **The raw snapshot is stored as `jsonb`** alongside the derived rows. When the
  detection rules change, evidence can be recomputed for every past import
  without re-hitting GitHub. Recomputation is cheap; API quota is not.
- **Derived evidence is normalised** so it can be indexed and sorted in the
  database rather than in application memory.
- **`user_id` is denormalised onto child tables.** It costs a column and removes
  a join from every RLS policy, which keeps the policies simple enough to read
  and therefore to trust.
- **Check constraints mirror the TypeScript unions** (`category`, `confidence`,
  score range). The database is the last line of defence, not the first. One goes
  further and encodes an invariant: a repo with a null `survival_score` must be
  banded `insufficient-data`, so the "we couldn't read enough" state cannot drift
  apart from the missing number.
- **Explanation payloads are `jsonb`** (`signals`, `reasons`). They are rendered,
  never filtered or joined on. Everything the app orders or queries by — score,
  rank, band, coverage — is a real column.

## Authentication

`getSession()` returns an `AppSession` in one of two modes:

- `supabase` — a real user, resolved from session cookies via `@supabase/ssr`.
  Every query then runs as that user and RLS applies.
- `local` — a fixed development identity used when no Supabase credentials are
  configured. It is **not** an authenticated principal, and the UI shows a
  persistent banner saying so.

This is what lets the whole product be developed and demonstrated without
provisioning any external service.

## Testing strategy

- **Pure logic is tested directly** with a frozen clock (`FIXTURE_NOW`), so no
  test depends on today's date.
- **The network is tested through a `fetchImpl` seam.** `createGitHubClient`
  accepts a fetch implementation; tests pass a route-matching stub. There is no
  mocking library and no global patching.
- **Failure paths are tested as first-class behaviour** — rate limits, unknown
  users, malformed manifests, empty repositories, truncated trees.
