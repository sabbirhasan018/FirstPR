# Project state

**Last updated:** 2026-08-18
**Current version:** v0.4.0
**Repository:** https://github.com/Niloy-Bhuiyan/FirstPR — CI green on `main`.

---

## What actually works

Four workflows, all verified in a browser against live data:

```
GitHub username  → repos scanned → skills evidenced with citations
evidenced skills → issue search  → repo health scored → issues ranked with reasons
any public repo  → architecture, commands, house rules → Setup Doctor on this machine
a local branch   → 12 preflight checks + drafts → ready (or not) to open a PR
```

## Live verification

| Workflow | Verified against |
| --- | --- |
| Profile import | `Niloy-Bhuiyan` — 12 repos, 5 cited skills |
| Issue discovery | 49 issues across 49 scored repos, 346 requests |
| Degraded discovery | quota exhausted on first scan; all 48 issues still ranked |
| Repo deep dive | `pallets/flask`, `expressjs/express`, `vitest-dev/vitest` |
| Import graph | `expressjs/express` — real module edges and package counts |
| Setup Doctor | this machine: node 24.15.0, npm 11.12.1, python 3.13.5, git 2.51.0 |
| PR Preflight | isolated demo repo — caught a planted secret, generated file, 702-line diff, missing tests, `wip` commit, empty description |
| CI | green on GitHub Actions: verify + secret scan |

## Test results

```
npm run verify
```

- `tsc --noEmit` — passes
- `eslint` — passes, no warnings
- `vitest run` — **241 passed / 241**, 18 files

No test spawns a real process against an uncontrolled machine, and no test
depends on the calendar: probes are injected and clocks are frozen.

## Architecture decisions

| ADR | Decision |
| --- | --- |
| [0001](decisions/0001-deterministic-evidence-engine.md) | Evidence is deterministic, not AI-derived |
| [0002](decisions/0002-credential-free-local-mode.md) | Every credential is optional |
| [0003](decisions/0003-store-raw-snapshot-alongside-derived-evidence.md) | Raw snapshots kept so rule changes replay free |
| [0004](decisions/0004-withhold-a-score-rather-than-guess.md) | Withhold a score rather than guess one |
| [0005](decisions/0005-conditional-requests-as-the-rate-limit-strategy.md) | Conditional requests, not a TTL cache |
| [0006](decisions/0006-adapt-to-the-budget-instead-of-failing.md) | Adapt to the rate-limit budget |
| [0007](decisions/0007-setup-doctor-runs-only-fixed-probes.md) | Setup Doctor never runs repository commands |
| [0008](decisions/0008-drafts-are-templates-not-generated-prose.md) | Drafts are templates, not generated prose |

## What is NOT done

Stated plainly, because the rest of this document is a list of things that work.

| Item | Status |
| --- | --- |
| GitHub OAuth flow | Written, type-checked, **never executed** |
| Supabase stores (both) | Written, reviewed, **never executed** |
| RLS policies, migrations 0001–0002 | Written, **never run against a database** |
| RLS isolation test (two users) | Not written — needs a live project |
| Repo mentor (cited AI answers) | Designed, unbuilt |
| Reproduction Builder | Unbuilt |
| Contribution Path / progression | Unbuilt |
| Playwright end-to-end tests | Unbuilt |
| Deployment | Unbuilt |

**The single largest risk is that every line of authenticated and database code
is unproven.** It compiles and reads correctly and has never once run. Until a
Supabase project exists, treat that portion as written, not working.

## Blockers

| Need | Blocks |
| --- | --- |
| Supabase project URL + anon key | OAuth, both stores, all RLS, the isolation test |
| An AI provider key | The repo mentor, the only remaining genuinely model-shaped feature |
| Vercel account | Deployment |

## Known limitations of what does work

- Byte-count depth flatters Jupyter notebooks.
- Only the 12 most recently pushed repos are deep-scanned per profile.
- Merged-PR dates approximated by `created_at`.
- Local mode is a development identity, not authentication.
- Issue search covers two languages; GitHub cannot OR them in one query.
- The merge-sample shrinkage constant is an opinion, not a calibration.
- Caches are per-process and die with the server.
- Setup Doctor covers Node, npm, Python, Go, Docker and Git only.
- The import graph samples 30 source files and states its own coverage.

## Next

1. Provision Supabase, then verify OAuth and RLS and write the isolation test.
   This converts the largest block of unproven code into proven code and should
   come before any new feature.
2. Repo mentor over the existing static analysis, with cited file paths and
   ADR 0001's validation rules.
3. Reproduction Builder.
4. Playwright coverage of the four workflows above.
5. Deployment.
