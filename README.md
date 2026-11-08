<div align="center">

<img src="docs/assets/firstpr-flow.svg" alt="FirstPR turns a GitHub username into cited evidence, a ranked issue, and a preflighted pull request" width="880">

### Find the open-source issue you can actually solve.

**Evidence-backed, not AI-guessed.** Every claim FirstPR makes about you links to a
file a reviewer can open. No language model scores anything.

[Quick start](#quick-start) · [How it works](#how-it-works) · [Docs](docs/) · [Limitations](#known-limitations)

</div>

---

## Why

The hard part of a first contribution isn't writing the patch. It's picking an
issue you can finish, in a repo that will actually review it.

FirstPR is deliberately *not* an auto-PR bot. It reads public repositories, derives
what you can prove you know, and ranks real issues against it. Commit counts are
never treated as skill.

## Quick start

Requires Node 20+. **No credentials needed** — with no `.env.local` the app runs in
*local mode* (in-memory store, dev identity, banner saying so).

```bash
npm install && npm run dev
```

Open <http://localhost:3000> and enter any public GitHub username.

<details>
<summary><b>Lifting the GitHub rate limit</b> — 60/hr anonymous → 5,000/hr</summary>

<br>

**As a user: just sign in with GitHub.** Your own token comes with the grant. You
never create or paste one.

For local development, copy `.env.example` to `.env.local` and set `GITHUB_TOKEN`
to a fine-grained token with **public read access only**. It is read server-side
and never sent to the browser.

Without a token the app *adapts rather than fails*: it checks the remaining budget
first (free), spends at most half, and scores more repos in less depth when quota
is scarce. Every result reports the budget it had.

</details>

## How it works

Four workflows, each end to end:

| # | Input | Output |
|---|---|---|
| 1 | GitHub username | Deterministic skill evidence + citations |
| 2 | Evidenced skills | Ranked issues with repo health and reasons |
| 3 | Any public repo | Architecture, build/test commands, house rules, Setup Doctor |
| 4 | A local branch | 12 preflight checks + maintainer drafts |

<details>
<summary><b>1 · The evidence engine</b></summary>

<br>

For each scanned repo the collector reads `/languages` (bytes per language), the
git tree (test files, CI, Dockerfiles, migrations), root manifests (frameworks
genuinely depended on) and merged-PR search.

```
score = 100 × (0.40 × breadth + 0.35 × freshness + 0.25 × depth)
```

**breadth** — repos showing the skill · **freshness** — 18-month half-life on last
push · **depth** — recency-weighted bytes or distinct artefacts.

Forks count at 25%, archived repos at 60%. All three components are shown in the
UI, so any number can be argued with.

Two rules the engine will not break:

1. A skill is never emitted without at least one citation.
2. A skill supported *only* by a self-declared repo topic is discarded. Topics are
   a claim, not evidence.

</details>

<details>
<summary><b>2 · Issue ranking, and why it ignores "good first issue"</b></summary>

<br>

```
score = 100 × (0.40 × skillMatch + 0.30 × repoHealth + 0.20 × approachability + 0.10 × specification)
```

Repo health — the **Survival Score** — combines maintainer activity, merge activity,
issue responsiveness, CI health, release cadence, open-PR freshness and contributor
docs. An unreadable signal *drops out of the denominator* rather than scoring zero,
and below 50% coverage **no score is produced at all**. It is not a merge
probability.

The `good first issue` filter is the baseline this ranking has to beat — it misses
workable unlabelled issues and happily returns labelled ones in dead repos. So the
comparison is an executable test, not a claim: on a benchmark set with known ground
truth, ranking scores **precision@3 of 1.00** against the baseline's **0.33**. If
that test ever inverts, the ranking should go.

</details>

<details>
<summary><b>3 · Understanding an unfamiliar repo</b></summary>

<br>

Open `/repo/<owner>/<name>` for build/test commands (lifted from CI, which a PR
actually has to survive — a README can be years stale, a workflow cannot), entry
points, directory roles, house rules from CONTRIBUTING, and **Setup Doctor**:
whether *your* machine has the runtimes the repo needs.

Every item links to the file it came from.

**Setup Doctor never runs a command from the repository** — only a fixed table of
version probes ([ADR 0007](docs/decisions/0007-setup-doctor-runs-only-fixed-probes.md)).
Build commands are shown for you to run yourself, deliberately.

</details>

<details>
<summary><b>4 · Preflight, before you open the PR</b></summary>

<br>

Point `/preflight` at a local branch and it runs the review a maintainer gives
before reading any code: secrets in the diff, generated files, diff size, missing
tests, placeholder commits, a stale branch, lockfile churn, house rules.

**Blockers** get a PR closed unread; **warnings** get commented on. Only blockers
gate readiness — a tool that treats every nit as fatal gets ignored.

It also drafts the PR description and maintainer comments as templates with your
real facts filled in and `<placeholders>` for the reasoning only you have
([ADR 0008](docs/decisions/0008-drafts-are-templates-not-generated-prose.md)).

All git commands are read-only. **Nothing is ever posted, pushed or opened on your
behalf.**

</details>

## Checks

```bash
npm run verify
```

`tsc --noEmit` + ESLint + 241 Vitest tests. CI runs these plus build and a secret
scan on every push.

## Status

**v0.4.0.** All four workflows above work end to end.

**Not built:** cited AI mentor, Reproduction Builder, progression tracking,
Playwright coverage. **Written but never executed:** GitHub OAuth, both Supabase
stores and all RLS policies — they need a live project.
[PROJECT_STATE.md](docs/PROJECT_STATE.md) lists this plainly.

## Known limitations

Real, and deliberately not papered over:

- **Byte counts flatter some languages.** A Jupyter notebook is mostly serialised output.
- **Only the 12 most recently pushed repos are deep-scanned.** Skipped repos are listed in the UI.
- **Merged-PR dates are approximate.** Search returns `created_at`, not `merged_at`.
- **Local mode is not authentication.** It is a dev identity with a fixed id.
- **The Supabase store has never run against a live database.**
- **Issue search covers two languages only** — GitHub's qualifiers cannot express OR across them.
- **The merge-sample shrinkage constant is an opinion, not a calibration.**
- **The response cache is per-process and in-memory**, so it is lost on restart.

## Documentation

| Document | Purpose |
|---|---|
| [docs/](docs/) | Architecture, project state, roadmap, eight decision records |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to work on this repo, and the rules it holds itself to |
| [SECURITY.md](SECURITY.md) | Threat model and reporting |

The decision records are worth reading before the code — they explain why scoring
is deterministic, why a repo score is withheld instead of guessed, and why Setup
Doctor refuses to run a command it read from a repository.

## Licence

MIT — see [LICENSE](LICENSE).
