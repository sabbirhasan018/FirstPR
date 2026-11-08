# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-08-18

Contribution. The app now covers the whole path: find an issue, understand the
repo, get it running, and check the pull request before a maintainer sees it.

### Added

- **Import graph and architecture map** (`src/lib/repo/graph.ts`). Parses imports
  from a sample of source files and collapses them to module granularity, with
  edge weights and cycle detection. Module-level on purpose: a node diagram of
  three thousand files is a hairball, while "which directory pulls on which" is
  what actually explains an architecture.
- **PR Preflight** (`src/lib/preflight/`). Twelve checks covering secrets,
  generated files, diff size, missing tests, issue links, descriptions, commit
  messages, DCO sign-off, stale branches, branch names and lockfile churn.
  Blockers gate readiness; warnings do not, because a tool that treats every nit
  as fatal gets ignored. Every failure carries a concrete fix, asserted by test.
- **Maintainer communication drafts** (`src/lib/drafts/`). Templates, not
  generated prose - see
  [ADR 0008](docs/decisions/0008-drafts-are-templates-not-generated-prose.md).
  Nothing is ever posted.
- **CI** (`.github/workflows/ci.yml`). Type check, lint, test and build, plus a
  secret scan that fails if a credential pattern or a real `.env` file is ever
  tracked. That second job exists because of a near miss during development.

### Known limitations

- The GitHub OAuth flow, both Supabase stores and all RLS policies remain
  **written but never executed** against a live project.
- The repo mentor (cited AI question answering) is designed but unbuilt.
- Reproduction Builder is unbuilt.
- The import graph samples 30 source files; its coverage is stated in the UI.

## [0.3.0] — 2026-08-18

Understanding. Once an issue is picked, the app explains the codebase it lives
in and whether this machine can build it.

### Added

- **Sign in with GitHub.** Each signed-in user brings their own GitHub token, so
  requests draw on their own 5,000/hour instead of a shared pool — nobody creates
  or pastes a token. Only `read:user` is requested; the app reads public data,
  which needs no scope, and `public_repo` would grant write access it has no
  business holding. Token resolution is explicit: user token, then server
  `GITHUB_TOKEN`, then anonymous.
- **Repo deep dive** (`src/lib/repo/`). Pure analysis producing entry points, key
  directories by role, build and test commands, runtime requirements and
  contributor rules — every item linked to the file it came from. Commands lifted
  from CI are marked and ranked first, because CI is what a pull request must
  survive.
- **Setup Doctor** (`src/lib/setup/`). Checks the local toolchain against what the
  repository states it needs, reporting missing tools and version mismatches with
  concrete fixes. It executes only a fixed table of version probes and never a
  command found in the repository — see
  [ADR 0007](docs/decisions/0007-setup-doctor-runs-only-fixed-probes.md).
- **Bounded concurrency helper** (`src/lib/concurrency.ts`), used for repo scans
  and file fetches.

### Fixed

Six defects found by running the analyzer against real repositories:

- CI parsing read only single-line `run:` steps, missing the block scalars most
  workflows use — `pallets/flask` surfaced one command and missed its test suite.
- The command classifier required the literal word "test", discarding
  `uv run … tox run`; and conversely matched "test" anywhere, presenting
  `cp ./test/e2e/…` from `vitest` as a way to run the suite.
- npm reported as missing on every Windows machine, because npm is `npm.cmd` and
  Node refuses to spawn `.cmd` without a shell.
- Contributor guides were matched as `.md` only, so Python projects using
  reStructuredText reported "no contributor rules".
- Version alternations such as `^22.12.0 || ^24.0.0 || >=26.0.0` read as
  uninterpretable.
- Repository health was keyed by GitHub's canonical `full_name`, so a renamed
  repository silently failed every lookup.

### Performance

- Repository scanning is concurrent rather than sequential: 44 repositories went
  from 3.7 minutes to 50 seconds.

### Known limitations

- The GitHub OAuth flow is written and type-checked but **has never run against a
  live Supabase project**.
- Setup Doctor covers Node, npm, Python, Go, Docker and Git only.
- Repo analysis reads a bounded set of files and at most three CI workflows.

## [0.2.0] — 2026-08-18

Issue discovery. The app can now go from evidenced skills to a ranked list of
open issues, with a reason attached to every placement.

### Added

- **Conditional-request cache** (`src/lib/github/cache.ts`). Responses are
  revalidated with ETags; a `304 Not Modified` reuses the cached body and costs
  no rate-limit quota. Chosen over a TTL cache because quota, not latency, is
  the binding constraint — see [ADR 0005](docs/decisions/0005-conditional-requests-as-the-rate-limit-strategy.md).
- **Repo Survival Score** (`src/lib/health/`). Seven weighted signals:
  maintainer activity, merge activity, issue responsiveness, CI health, release
  cadence, open-PR freshness and contributor documentation. Unreadable signals
  drop out of the denominator instead of scoring zero, and below 50% coverage no
  score is produced at all — see [ADR 0004](docs/decisions/0004-withhold-a-score-rather-than-guess.md).
  It is never presented as a merge probability.
- **Issue matcher** (`src/lib/issues/`). Ranks on skill match, repo health,
  approachability and specification quality. Assigned issues, archived repos and
  blocked/duplicate labels are excluded, and the exclusions are shown so the
  filtering is auditable.
- **Budget-bounded discovery** (`src/lib/services/discover-issues.ts`). Scores
  repositories most-represented first until the request budget runs out, then
  reports which ones went unscored rather than dropping them silently.
- **Migration 0002** persisting discovery runs, repo health and ranked issues,
  with the same owner-only RLS shape as 0001 and a constraint enforcing that an
  unscored repo is banded as unscored.
- **Recommended Issues page** showing each ranking's reasons, the repo health
  band behind it, and the filtered-out list.
- **An executable kill-condition test.** The roadmap promised to delete this
  ranking if it could not beat a naive language + "good first issue" filter.
  Against a benchmark set with known ground truth, ranking scores precision@3 of
  1.00 versus the baseline's 0.33, and surfaces workable issues the filter drops
  entirely.

### Changed

- `GitHubClient.requestCount()` became `stats()`, reporting both total requests
  and how many were free 304s.
- **Rate-limit adaptation** ([ADR 0006](docs/decisions/0006-adapt-to-the-budget-instead-of-failing.md)).
  Anonymous GitHub allows 60 requests an hour, which made the app roughly
  one-action-per-hour. Discovery now checks the budget first via `/rate_limit`
  (which is itself free), spends at most half of what remains, and trades scan
  depth for breadth when quota is scarce — scoring repositories on the three
  highest-weight signals (3 requests, 0.65 coverage) rather than all seven.
  Roughly 2.5× more repositories scored on the same anonymous budget, and an
  empty budget now fails immediately with a reset time instead of dying midway.

### Fixed

- Contributor documentation scored zero when the community-profile request was
  unavailable, punishing a repository for a request the app failed to make. It
  is now correctly reported as an unmeasured signal.
- Running out of GitHub quota partway through scoring repositories no longer
  discards the whole ranking. Discovery keeps what it scored, ranks everything,
  and explains what happened.
- Issues from repositories the request budget could not scan were scored with a
  skill match of zero, despite having been found by a language search that
  already proved the language matches. Candidates now carry that language.
- The "filtered out" count read from a field the Supabase store does not persist,
  so under Postgres it would have reported zero after discarding dozens.
- `allowedDevOrigins` is set, without which Next blocked its own dev chunks as
  cross-origin, React never hydrated, and every form silently did nothing.

### Known limitations

- Small merge samples are shrunk toward zero, but the shrinkage constant is an
  opinion, not a calibration.
- Search covers only the two strongest evidenced languages, because GitHub's
  search qualifiers cannot express OR across languages and each one costs a
  request.
- The cache is per-process and in-memory, so it dies with the server.
- Discovery persistence, like all Supabase code here, remains unverified against
  a live database.

## [0.1.0] — 2026-08-18

First vertical slice. A GitHub username goes in; cited skill evidence comes out.

### Added

- **Deterministic evidence engine** (`src/lib/evidence/`). Skill scores are a
  fixed weighted sum of breadth, freshness and depth. No language model is
  involved. A skill is never emitted without a citation, and a skill supported
  only by a self-declared repo topic is discarded.
- **GitHub collector** (`src/lib/github/`). Reads languages, the recursive file
  tree and root manifests for up to 12 recently-pushed repositories in ~2–4
  requests each. Every response is Zod-validated at the network boundary.
  Rate limits, per-repo errors and empty repositories degrade to a partial
  snapshot with user-visible warnings.
- **Manifest parsing** for `package.json`, `requirements.txt`, `pyproject.toml`,
  `go.mod` and `Cargo.toml`.
- **Postgres schema** (`supabase/migrations/0001_init.sql`) with owner-only row
  level security on all four tables, indexes, check constraints mirroring the
  TypeScript unions, and an `auth.users` trigger that provisions profiles.
- **Store abstraction** with an in-memory implementation for local mode and a
  Supabase implementation for deployment.
- **Local mode**: the app runs with no credentials at all, using an in-memory
  store and a clearly-labelled development identity.
- **Dashboard and Profile Evidence pages**, responsive from 375px, showing each
  score's three components and an explicit panel listing what the scan could
  not see.
- 45 unit and integration tests, run against a frozen clock.

### Known limitations

- The Supabase store and RLS policies have not been executed against a live
  database; that requires project credentials.
- Byte-count depth flatters Jupyter notebooks, which are largely serialised
  output.
- Merged-PR timestamps are approximated by `created_at`, as GitHub's search API
  does not return `merged_at`.

[0.4.0]: https://github.com/Niloy-Bhuiyan/FirstPR/releases/tag/v0.4.0
[0.3.0]: https://github.com/Niloy-Bhuiyan/FirstPR/releases/tag/v0.3.0
[0.2.0]: https://github.com/Niloy-Bhuiyan/FirstPR/releases/tag/v0.2.0
[0.1.0]: https://github.com/Niloy-Bhuiyan/FirstPR/releases/tag/v0.1.0
