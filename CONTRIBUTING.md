# Contributing

## Setup

```bash
npm install
```

```bash
npm run dev
```

No credentials are needed. See `.env.example` for what each optional variable
unlocks.

## Before you open a pull request

```bash
npm run verify
```

This must pass. It runs type checking, ESLint and the full Vitest suite.

## House rules

**The evidence engine stays pure.** `src/lib/evidence/` performs no I/O and reads
no environment. It receives a snapshot and a clock and returns a report. If you
need data, collect it in `src/lib/github/` and pass it in.

**Every skill needs a citation.** Do not add a detection rule that can fire
without producing something a reviewer can open. Self-declared repo topics are
explicitly not sufficient on their own.

**Freeze the clock in tests.** Use `FIXTURE_NOW` from
`src/lib/evidence/fixtures.ts`. A test that passes today and fails in eighteen
months is a broken test.

**Stub the network at the seam.** `createGitHubClient` accepts a `fetchImpl`.
Pass a stub. Do not patch globals or add a mocking library.

**Test the failure path too.** Rate limits, unknown users, malformed manifests
and empty repositories are normal conditions here, not edge cases.

**Deterministic logic before AI.** If a rule can answer the question, a model
should not be asked. When AI is genuinely needed, its output must be schema
validated and must carry provenance before it is stored.

**Missing data is not bad data.** When a signal cannot be read, drop its weight
from the denominator — never score it zero, and never quietly substitute an
average. If too little is observable, return no score at all and say so.

**Spend rate limit deliberately.** GitHub allows 60 requests an hour without a
token. Any new collection path needs a request budget, must reuse the ETag cache,
and must report what it skipped rather than silently truncating.

**A ranking must be able to justify itself.** Anything that reorders a list for
the user carries a reason per item. If you cannot write the sentence explaining a
placement, the signal is not ready to ship.

## Commits

One coherent change per commit, with a message that explains *why*. Do not split
a trivial edit across several commits, and never commit code you have not run.

## Adding a detection rule

Rules live in `src/lib/evidence/rules.ts`. A rule should only match an artefact
that would not exist unless the skill were genuinely in use — a CI workflow file,
a declared dependency, a migration directory. Add a test in `engine.test.ts`
asserting both that it fires and what it cites.
