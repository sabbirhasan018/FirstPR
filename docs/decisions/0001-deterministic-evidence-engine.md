# ADR 0001 — The evidence engine is deterministic, not AI

- **Status:** accepted
- **Date:** 2026-08-18

## Context

The product's promise is that a user can trust what it says about their skills,
and that a maintainer would accept the reasoning. An obvious implementation is to
hand repository contents to a language model and ask it to summarise what the
person knows.

## Decision

Skill derivation is a pure function over observed artefacts. No model participates
in scoring. Each score is a fixed weighted sum of breadth, freshness and depth,
with named constants at the top of `engine.ts`.

## Consequences

**Good:**

- Two runs over one snapshot always agree, so the output is testable at all.
- Every claim carries a citation, so a user can check it and a maintainer can
  verify it.
- Scoring costs nothing per import and cannot hallucinate a framework.
- The weights are visible and therefore arguable — a user who disagrees can point
  at the constant that is wrong.

**Bad:**

- Coverage is limited to what the rules recognise. A skill with no filesystem
  fingerprint is invisible.
- The rule table needs maintenance as ecosystems change.

**Accepted anyway** because a confidently wrong skill claim is far more damaging
to this product than a missing one. The UI compensates by listing what the scan
could not see.

## Where AI is still appropriate

Later phases use models for summarising real static analysis and drafting
maintainer messages — tasks with no deterministic answer. Even there, output must
be schema validated and carry provenance before it is stored, and it never
becomes trusted database state silently.
