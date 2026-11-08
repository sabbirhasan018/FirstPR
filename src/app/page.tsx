import Link from 'next/link';
import { ImportForm } from '@/components/import-form';
import { SkillCard } from '@/components/skill-card';
import { getSession } from '@/lib/auth/session';
import { getStore } from '@/lib/store';

// Depends on the signed-in user and the store, neither of which exist at build time.
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    return (
      <p className="nb-panel p-6 text-base font-bold">Sign in to import a GitHub profile.</p>
    );
  }

  const latest = await (await getStore()).latestImport(session.userId);

  return (
    <div className="space-y-10">
      <section className="mx-auto max-w-2xl text-center">
        <h1 className="text-[2.7rem] leading-[1.02] font-black tracking-tight sm:text-6xl">
          What can you <span className="text-accent">actually prove</span> you know?
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base font-semibold text-muted sm:text-lg">
          FirstPR reads public repositories and derives skill evidence from what is really there —
          languages by byte count, dependencies in manifests, test and CI files, merged pull
          requests. Commit counts are not treated as skill.
        </p>
      </section>

      <section className="nb-panel mx-auto max-w-xl p-5 sm:p-8">
        <ImportForm defaultLogin={session.githubLogin ?? undefined} />
      </section>

      {latest ? (
        <>
          <section>
            <h2 className="text-2xl font-black">Latest import</h2>
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Profile" value={latest.githubLogin} />
              <Stat label="Repos scanned" value={String(latest.snapshot.repos.length)} />
              <Stat label="Skills evidenced" value={String(latest.report.skills.length)} />
              <Stat label="Merged PRs" value={String(latest.snapshot.mergedPullRequestTotal)} />
            </dl>
          </section>

          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-2xl font-black">Strongest evidence</h2>
              <Link href="/evidence" className="nb-link text-sm">
                See all {latest.report.skills.length} skills
              </Link>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {latest.report.skills.slice(0, 6).map((skill) => (
                <SkillCard key={skill.skillId} skill={skill} />
              ))}
            </div>
          </section>
        </>
      ) : (
        <section className="nb-dashed p-6 text-base font-semibold text-muted">
          No import yet. Enter a GitHub username above to build an evidence profile.
        </section>
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
