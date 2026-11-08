# Documentation

| Document | What it covers |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Module boundaries, the pure engines, rate-limit strategy, data model |
| [PROJECT_STATE.md](PROJECT_STATE.md) | What works, what is unproven, what is unbuilt, current blockers |
| [ROADMAP.md](ROADMAP.md) | Phases and what each one has to prove |
| [BACKLOG.md](BACKLOG.md) | Ideas deliberately kept out of scope |
| [decisions/](decisions/) | Architecture decision records |

## Decision records

Each ADR states the context, the decision, and the consequences — including the
bad ones, since a decision record that only lists benefits is marketing.

| ADR | Decision |
| --- | --- |
| [0001](decisions/0001-deterministic-evidence-engine.md) | Evidence is deterministic, not AI-derived |
| [0002](decisions/0002-credential-free-local-mode.md) | Every credential is optional |
| [0003](decisions/0003-store-raw-snapshot-alongside-derived-evidence.md) | Raw snapshots are kept so rule changes replay without API quota |
| [0004](decisions/0004-withhold-a-score-rather-than-guess.md) | Withhold a repo score rather than guess one |
| [0005](decisions/0005-conditional-requests-as-the-rate-limit-strategy.md) | Conditional requests, not a TTL cache |
| [0006](decisions/0006-adapt-to-the-budget-instead-of-failing.md) | Adapt to the rate-limit budget instead of failing on it |
| [0007](decisions/0007-setup-doctor-runs-only-fixed-probes.md) | Setup Doctor never runs a command from the repository |
| [0008](decisions/0008-drafts-are-templates-not-generated-prose.md) | Maintainer drafts are templates, not generated prose |
