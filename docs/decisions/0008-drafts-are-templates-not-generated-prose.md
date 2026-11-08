# ADR 0008 — Maintainer drafts are templates, not generated prose

- **Status:** accepted
- **Date:** 2026-08-18

## Context

A first contribution needs several pieces of writing: a pull request
description, a comment asking to take an issue, a follow-up when a PR goes
quiet, a reply to review feedback. These are exactly the places where a
newcomer freezes, and exactly the shape of task a language model is good at.

The obvious implementation is to generate them. Feed the diff and the issue to
a model and let it write.

## Decision

Every draft is a fixed template with the user's own observed facts substituted
in. No model is involved. Anything the user alone can know is left as an
explicit `<placeholder>` rather than guessed at, and a test asserts the
reasoning fields stay placeholders.

## Consequences

**Good:**

- The draft cannot invent a rationale the contributor never had. A description
  claiming "this fixes a race condition in the connection pool" when the author
  fixed a typo is worse than an empty box — it will be believed, then found out
  in review.
- The output does not read as generated. Maintainers have developed a strong
  allergy to enthusiastic, content-free contribution comments, and a template
  that stays terse avoids the tell entirely.
- No API key, no cost, no latency, no failure mode.
- Deterministic, so it is testable like everything else here.

**Bad:**

- The drafts are scaffolds, not finished text. The user still has to write the
  substance.
- Nothing adapts to unusual situations a template did not anticipate.

**Accepted** because the substance is the part that has to be the contributor's
own. A tool that writes the reasoning for them produces contributors who cannot
answer the first review question — which is worse for them than a blank page.

## Where this leaves AI

This is the second place a model would have been the obvious choice and was
rejected, after [ADR 0001](0001-deterministic-evidence-engine.md). That is not a
position against AI; it is the ordering the project committed to — deterministic
logic first, and a model only where there is no deterministic answer.

The genuinely model-shaped task in this product remains the repo mentor:
answering "why is this code like this?" over real static analysis, with cited
file paths. That is unbuilt, and when it is built the rules from ADR 0001 apply
— structured output, schema validation, provenance, and never silently promoting
model output to trusted state.

## Not negotiable

Nothing composed here is ever posted automatically. Drafts are text to read,
edit and paste. An assistant that opens pull requests on someone's behalf is the
spam bot this project exists not to be.
