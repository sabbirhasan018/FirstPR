# Security

## Reporting

Open a private security advisory on the GitHub repository. Please do not open a
public issue for an exploitable finding.

## Threat model

| Asset | Threat | Control |
| --- | --- | --- |
| A user's evidence data | Another user reads or writes it | Row level security on all four tables, owner-only policies, enabled explicitly. `user_id` is denormalised onto child tables so no policy depends on a join. |
| GitHub token | Leaked into the client bundle or git history | Read server-side only, never prefixed `NEXT_PUBLIC_`, never written to a committed file. `.gitignore` excludes `.env*` and allowlists only `.env.example`. |
| Supabase service-role key | Committed or used from the app | Not used by this application at all. The app uses the anon key with RLS. |
| GitHub API responses | Malformed or hostile payloads crash or poison the app | Every response is parsed with a Zod schema at the network boundary before use. |
| User input (`login`) | Injection into a request path | Validated against GitHub's own username grammar *before* any request, then URL-encoded. |
| Rate limit | Denial of service against GitHub, or a stuck UI | Bounded deep-scan limit, request accounting, and explicit degradation to a partial snapshot with a user-visible warning. |

## Deliberate non-goals in Phase 0

- **Local mode is not authentication.** It grants a fixed development identity
  with no verification. It exists so the app can be built and demonstrated
  without provisioning Supabase, and the UI states this in a persistent banner.
  It must never be enabled in a deployed environment — which is enforced by the
  fact that it activates only when Supabase credentials are *absent*.
- **The RLS policies have not been executed against a live database.** They are
  written and reviewed but unverified. Phase 1 must include a test that signs in
  as two users and asserts neither can read the other's rows.

## Secret handling

`npm run verify` does not scan for secrets. Before every commit the working tree
is grepped for token patterns (`ghp_`, `github_pat_`, `sk-…`, JWT prefixes,
PEM private key headers). Adding this as a pre-commit hook is tracked in
[BACKLOG.md](docs/BACKLOG.md).
