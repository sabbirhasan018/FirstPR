# ADR 0002 — Credential-free local mode

- **Status:** accepted
- **Date:** 2026-08-18

## Context

The application is designed around Supabase for auth and persistence, and around
GitHub for data. Requiring either to be provisioned before anything can run would
block all development on an external approval step, and would make the project
impossible for a reviewer to try.

## Decision

Every environment variable is optional. When Supabase credentials are absent the
app enters *local mode*: `getSession()` returns a fixed development identity and
`getStore()` returns an in-memory store. A persistent banner in the UI states
that data is in memory and will be lost on restart.

Mode selection is derived solely from whether credentials exist. There is no
flag a deployment could set to enable local mode with a real database present.

## Consequences

**Good:**

- `npm install && npm run dev` gives a working product with no setup.
- Development of unrelated modules is never blocked on credentials.
- The `EvidenceStore` interface is exercised by two real implementations, which
  keeps the abstraction honest rather than theoretical.

**Bad:**

- The Supabase code path is not exercised by running the app locally, so it can
  rot undetected. This is a real risk and is recorded as a known limitation
  rather than hidden: the RLS policies are unverified until Phase 1 adds an
  integration test against a live project.

## Explicitly not decided

Local mode is not a security model. It is not authentication, and it must never
be reachable in a deployed environment — which holds because it activates only
when Supabase credentials are missing.
