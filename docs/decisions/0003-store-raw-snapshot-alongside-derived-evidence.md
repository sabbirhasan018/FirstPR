# ADR 0003 — Store the raw snapshot alongside derived evidence

- **Status:** accepted
- **Date:** 2026-08-18

## Context

An import produces two things: the raw observations collected from GitHub, and
the evidence derived from them. Storing only the derived rows is the smaller
option. But the detection rules and scoring weights are expected to change often
— that is the whole point of ADR 0001 making them visible and arguable — and
GitHub API quota is the scarcest resource in the system.

## Decision

`evidence_snapshots.raw_snapshot` holds the complete `ProfileSnapshot` as `jsonb`.
Derived evidence is *also* written, normalised across `skill_evidence` and
`evidence_citations`.

## Consequences

**Good:**

- When a rule changes, every past import can be re-scored offline. No GitHub
  requests, no waiting on rate limits, and historical profiles stay comparable
  with current ones.
- Derived rows stay relational, so ranking and filtering happen in Postgres with
  an index rather than in application memory.
- The raw snapshot is a debugging record: a surprising score can be reproduced
  exactly by replaying it through the engine.

**Bad:**

- The same information is stored twice, and the two can drift if a write path
  updates one without the other.
- `jsonb` snapshots are the largest thing in the database and will dominate
  storage growth.

**Mitigation:** the raw snapshot is treated as immutable. Derived rows are only
ever written as part of the same insert that creates the snapshot, and
re-scoring will create a new snapshot row rather than mutating an old one.
