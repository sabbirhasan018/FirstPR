import Link from 'next/link';
import { DiscoverButton } from '@/components/discover-button';
import { IssueCard } from '@/components/issue-card';
import { getSession } from '@/lib/auth/session';
import { getStore } from '@/lib/store';

// Depends on the signed-in user and the store, neither of which exist at build time.
export const dynamic = 'force-dynamic';

export default async function IssuesPage() {
  const session = await getSession();
  if (!session) {
    return <p className="nb-panel p-6 text-base font-bold">Sign in to get issue recommendations.</p>;
  }

  const store = await getStore();
  const [evidence, discovery] = await Promise.all([
    store.latestImport(session.userId),
    store.latestDiscovery(session.userId),
  ]);

  const healthByRepo = new Map((discovery?.health ?? []).map((repo) => [repo.fullName, repo]));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Recommended issues</h1>
        <p className="mt-2 max-w-2xl text-base font-semibold text-muted">
          Open, unassigned issues in the languages you have actually evidenced, ranked by how well
          they match your skills and how likely the repository is to look at a contribution. Every
          ranking shows its reasons.
        </p>
      </header>

      {!evidence ? (
        <section className="nb-dashed p-6 text-base font-semibold text-muted">
          Ranking needs your evidenced skills first.{' '}
          <Link href="/" className="nb-link">
            Import a GitHub profile
          </Link>
          .
        </section>
      ) : (
        <section className="nb-panel mx-auto max-w-xl p-5 sm:p-8">
          <DiscoverButton />
        </section>
      )}

      {discovery && (
        <>
          <section>
            <h2 className="text-2xl font-black">This run</h2>
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Issues ranked" value={String(discovery.ranking.ranked.length)} />
              <Stat label="Repos scored" value={String(discovery.health.length)} />
              <Stat label="Filtered out" value={String(discovery.excludedCount)} />
              <Stat label="GitHub requests" value={String(discovery.requestsUsed)} />
            </dl>
          </section>

          {discovery.ranking.notes.length > 0 && (
            <section
              aria-labelledby="run-notes"
              className="nb-card p-4"
            >
              <h2 id="run-notes" className="text-base font-black">
                How this list was built
              </h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm font-semibold text-muted">
                {discovery.ranking.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="text-2xl font-black">Ranked</h2>
            {discovery.ranking.ranked.length === 0 ? (
              <p className="mt-2 text-sm font-semibold text-muted">
                Nothing survived filtering. Every candidate was assigned, archived or labelled as
                not ready.
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                {discovery.ranking.ranked.slice(0, 20).map((entry) => (
                  <IssueCard
                    key={entry.issue.id}
                    entry={entry}
                    health={healthByRepo.get(entry.issue.repoFullName)}
                  />
                ))}
              </div>
            )}
          </section>

          {discovery.ranking.excluded.length > 0 && (
            <section>
              <h2 className="text-2xl font-black">Filtered out</h2>
              <p className="text-sm font-semibold text-muted">
                Shown so the filtering is auditable rather than invisible.
              </p>
              <ul className="mt-3 space-y-2">
                {discovery.ranking.excluded.slice(0, 15).map(({ issue, reason }) => (
                  <li
                    key={issue.id}
                    className="nb-card-flat px-3 py-2 text-xs"
                  >
                    <a
                      href={issue.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="nb-link"
                    >
                      {issue.repoFullName}#{issue.number}
                    </a>
                    <span className="font-semibold text-muted"> — {reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="nb-card px-3 py-2.5">
      <dt className="text-xs font-bold text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 truncate text-xl font-black">{value}</dd>
    </div>
  );
}
