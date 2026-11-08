# ADR 0004 — Withhold a repo score rather than guess one

- **Status:** accepted
- **Date:** 2026-08-18

## Context

The Repo Survival Score summarises seven signals about a repository. In practice
several of them are often unreadable: a repo may have no releases, no GitHub
Actions, a `community/profile` endpoint that 404s, or an API call that simply
fails. The obvious implementations are both wrong:

- **Score a missing signal as zero.** This punishes a healthy project for not
  using GitHub Actions, and makes "we couldn't read it" indistinguishable from
  "they've abandoned it".
- **Score a missing signal as average.** This silently invents data, and the
  user has no way to tell how much of the number is real.

There is also constant pressure to present the number as a merge probability,
because that is the question users actually have.

## Decision

Three rules:

1. **An unavailable signal drops out of the denominator.** Its weight is removed
   from the total rather than contributing a value. Ignorance is not evidence of
   neglect.
2. **Below 50% observable weight, no score is produced at all.** `survivalScore`
   is `null`, the band is `insufficient-data`, and the UI says to judge the repo
   yourself. The database enforces this pairing with a check constraint.
3. **The score is never called a merge probability.** Every summary states that
   it is a summary of observable behaviour, and a test asserts that wording is
   present.

Downstream, an unscored repo contributes a neutral 0.5 to issue ranking — again,
unknown is not the same as bad.

## Consequences

**Good:**

- The number means one thing consistently, and `coverage` says how much of it is
  real.
- Repos with unconventional but healthy workflows are not punished for it.
- The product cannot quietly become a merge-probability oracle it has no
  statistical basis to be.

**Bad:**

- Some repositories get no score, which is less satisfying than a number.
- Coverage is one more concept for a user to understand.

**Accepted anyway** because a confident score computed from two of seven signals
is worse than an honest refusal — it would be trusted exactly as much as a
well-founded one, and it would be wrong.
