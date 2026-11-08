import Link from 'next/link';
import { SkillCard } from '@/components/skill-card';
import { getSession } from '@/lib/auth/session';
import type { SkillCategory } from '@/lib/evidence/types';
import { getStore } from '@/lib/store';

const CATEGORY_ORDER: { id: SkillCategory; title: string; blurb: string }[] = [
  {
    id: 'language',
    title: 'Languages',
    blurb: 'Weighted by bytes written, discounted for forks and for age.',
  },
  {
    id: 'framework',
    title: 'Frameworks',
    blurb: 'Proven by a dependency in a manifest or a framework config file.',
  },
  {
    id: 'practice',
    title: 'Engineering practices',
    blurb: 'Proven by files that only exist when the practice is actually followed.',
  },
  {
    id: 'infrastructure',
    title: 'Infrastructure',
    blurb: 'Container, orchestration and provisioning definitions found in the repos.',
  },
];

// Depends on the signed-in user and the store, neither of which exist at build time.
export const dynamic = 'force-dynamic';

export default async function EvidencePage() {
  const session = await getSession();
  if (!session) {
    return <p className="nb-panel p-6 text-base font-bold">Sign in to view your evidence profile.</p>;
  }

  const latest = await (await getStore()).latestImport(session.userId);

  if (!latest) {
    return (
      <div className="nb-dashed p-6 text-base font-semibold text-muted">
        Nothing imported yet.{' '}
        <Link href="/" className="nb-link">
          Import a profile
        </Link>{' '}
        to see evidence here.
      </div>
    );
  }

  const { report, snapshot } = latest;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
          Evidence for {report.login}
        </h1>
        <p className="mt-2 text-base font-semibold text-muted">
          Collected {new Date(snapshot.collectedAt).toLocaleString()} from{' '}
          {snapshot.repos.length} repositories.
        </p>
      </header>

      {report.notes.length > 0 && (
        <section
          aria-labelledby="gaps-heading"
          className="nb-card p-4"
        >
          <h2 id="gaps-heading" className="text-base font-black">
            What this scan could not see
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm font-semibold text-muted">
            {report.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      {CATEGORY_ORDER.map(({ id, title, blurb }) => {
        const skills = report.skills.filter((skill) => skill.category === id);
        if (skills.length === 0) return null;

        return (
          <section key={id}>
            <h2 className="text-2xl font-black">{title}</h2>
            <p className="text-sm font-semibold text-muted">{blurb}</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {skills.map((skill) => (
                <SkillCard key={skill.skillId} skill={skill} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
