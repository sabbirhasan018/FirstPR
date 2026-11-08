# Roadmap

Each phase must end with a workflow a person can actually run. A phase is not
done because its code exists.

## Phase 0 — v0.1.0 — Foundation ✅

**Proves:** evidence can be derived from public GitHub data deterministically.

- [x] Next.js + TypeScript + Tailwind + Vitest toolchain
- [x] Supabase schema, RLS policies, indexes, constraints
- [x] Session abstraction with credential-free local mode
- [x] GitHub collector with rate-limit and partial-failure handling
- [x] Deterministic skill evidence engine with mandatory citations
- [x] Dashboard + Profile Evidence pages, responsive from 375px
- [x] 45 unit/integration tests

**Not done:** Supabase path unverified against a live database (needs credentials).

## Phase 1 — v0.2.0 — Discovery ✅

**Proves:** ranking beats a naive label filter, or the approach gets simplified.

- [x] Issue ingestion with ETag-based conditional requests and a request budget
- [x] Repo Survival Score: maintainer activity, merge activity, issue
      responsiveness, CI health, release cadence, open-PR freshness, contributor docs
- [x] Issue matching against the evidence profile, with a written reason per match
- [x] Assignment, archive and blocked-label filtering, with exclusions shown
- [x] Migration 0002 persisting runs so a page view does not re-spend quota
- [x] Recommended Issues page

**Kill condition — checked, and passed.** The comparison is an executable test,
not a claim: against a benchmark set with known ground truth, ranking scores
precision@3 of 1.00 versus the naive language + "good first issue" filter's 0.33,
and surfaces workable issues the filter drops entirely. If that test ever
inverts, this ranking should be deleted in favour of the filter.

**Not done:** RLS integration test still needs live Supabase credentials.

## Phase 2 — v0.3.0 — Understanding ✅ (partial)

**Proves:** a stranger can get productive in an unfamiliar repo in ten minutes.

- [x] Per-user GitHub OAuth — users bring their own rate limit, no token handling
- [x] Entry points, key directories, build and test commands extracted from the
      repo and its CI, each linked to the file it came from
- [x] Setup Doctor: validates runtimes and package managers against what the repo
      states it needs, executing only fixed probes ([ADR 0007](decisions/0007-setup-doctor-runs-only-fixed-probes.md))
- [x] Contributor-rule extraction from CONTRIBUTING and PR templates
- [ ] Dependency/import graph and architecture map from static analysis
- [ ] Reproduction Builder: expected vs actual, steps, logs, failing-test candidate
- [ ] AI mentor answering questions with cited file paths — AI summarises real
      analysis, it does not guess
- [ ] RLS integration test signing in as two users, carried over from Phase 1

**Deferred deliberately.** The deep dive and Setup Doctor deliver the phase's
promise on their own, and were worth finishing properly — six real defects only
appeared when the analyzer met `pallets/flask` and `vitest-dev/vitest`. The
import graph and AI mentor are the next slice, not abandoned.

**Blocked on credentials:** the OAuth flow and the RLS test both need a live
Supabase project.

## Phase 3 — v0.4.0 — Contribution

**Proves:** the PR that leaves this tool is better than the one that wouldn't have.

- PR Preflight: tests, lint, issue link, contributor guide, unrelated files,
  generated/vendor files, secrets, diff size, missing tests, stale branch
- Maintainer communication drafts — composed, never auto-posted
- Contribution Path: proven skills updated after each contribution, next issue
  recommended one step harder
- Playwright end-to-end coverage of the full workflow

## Phase 4 — v1.0.0 — Production

- Security review, performance budget, accessibility audit
- Production Supabase migrations and deployment config
- CI/CD and observability
- Fresh-install verification and release notes

## Principles that outrank the schedule

- Correctness > security > architecture > schema > tests > workflow > AI > polish.
- Deterministic software before AI, every time.
- Never optimise for generated PR volume. The metric is merged, useful patches.
