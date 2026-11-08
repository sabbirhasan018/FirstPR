# Backlog

Ideas deliberately kept out of the MVP. Nothing here is scheduled; it is here so
it stops competing for attention with the defined phases.

## Engine quality

- **Notebook byte discounting.** Jupyter `.ipynb` files are mostly serialised
  output, so byte-count depth overstates them. Parsing out `source` cells would
  be more honest. Affects any notebook-heavy profile.
- **Per-language depth targets.** 200 kB of Go and 200 kB of HTML are not
  comparable amounts of work; one target for all languages is a known
  simplification.
- **Vendored code exclusion.** `vendor/`, `node_modules/` committed by accident,
  and generated clients currently count toward language bytes.
- **Commit authorship weighting.** A repo the user contributed 3% of should not
  count as fully theirs. Needs the contributors endpoint.

## Collection

- **Persistent, shared response cache.** The ETag cache landed in v0.2.0 but is
  per-process and in-memory, so it dies with the server and is not shared between
  instances. Moving it to Postgres or Redis is a change of storage, not strategy.
- **Deep-scan beyond 12 repos** when a token is present and the budget allows.
- More manifest ecosystems: `Gemfile`, `pom.xml`, `build.gradle`, `composer.json`.

## Discovery quality

- **Calibrate the merge-sample shrinkage.** The constant that stops a 2-for-2
  repo outranking a 30-for-30 one is currently an opinion. Real merge data would
  make it a measurement.
- **Search more than two languages.** GitHub cannot OR languages in one query, so
  each costs a request; worth revisiting once a token is standard.
- **Time-to-first-response** instead of "did anyone reply". A far better
  responsiveness signal, but it needs per-issue comment timelines — one request
  each, which the budget cannot afford today.
- **Duplicate detection** across issues. Currently only the `duplicate` label is
  honoured; textual similarity would catch the rest.
- **Grow the benchmark set** used by the kill-condition test. Eight hand-built
  cases prove the ranking beats the naive filter on cases chosen to be
  discriminating; they do not prove it generalises.

## Platform

- **Pre-commit secret-scanning hook.** Currently a manual grep before each commit.
- **RLS integration test** signing in as two users and asserting isolation.
- **GitHub Actions CI** running `npm run verify` on every push.
- Playwright end-to-end coverage (planned properly for Phase 3).

## Product

- Export an evidence profile as a shareable page or PDF.
- "Explain this score" drill-down showing the arithmetic, not just the components.
- Let a user mark a repo as not-really-mine and have it excluded.
