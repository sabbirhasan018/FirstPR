import Link from 'next/link';
import { ArchitectureMap } from '@/components/architecture-map';
import { SetupDoctorPanel } from '@/components/setup-doctor-panel';
import { resolveGitHubToken } from '@/lib/auth/github-token';
import { getSession } from '@/lib/auth/session';
import type { CommandKind } from '@/lib/repo/types';
import { analyzeRepository } from '@/lib/services/analyze-repo';

export const dynamic = 'force-dynamic';

const COMMAND_LABELS: Record<CommandKind, string> = {
  install: 'Install',
  build: 'Build',
  test: 'Test',
  lint: 'Lint',
  typecheck: 'Type check',
  dev: 'Run locally',
};

export default async function RepoDeepDivePage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; name: string }>;
  searchParams: Promise<{ refresh?: string }>;
}) {
  const { owner, name } = await params;
  const { refresh } = await searchParams;
  const fullName = `${owner}/${name}`;

  const session = await getSession();
  const result = await analyzeRepository(fullName, {
    githubToken: resolveGitHubToken(session).token,
    refresh: refresh === '1',
  });

  if (!result.ok) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-black tracking-tight">{fullName}</h1>
        <p className="nb-card bg-accent p-4 text-sm font-bold text-background">{result.error}</p>
        <Link href="/issues" className="nb-link text-sm">
          Back to recommended issues
        </Link>
      </div>
    );
  }

  const { analysis, setup } = result;

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-bold text-muted uppercase">Repo deep dive</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">
          <a
            href={analysis.htmlUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="nb-link"
          >
            {analysis.fullName}
          </a>
        </h1>
        <p className="mt-3 text-base font-semibold text-muted">
          {analysis.fileCount} files, {analysis.ecosystems.join(' + ')}. Everything below was read
          from the repository — each item links to the file it came from.
          {result.cached && (
            <>
              {' '}
              Served from an earlier scan.{' '}
              <Link
                href={`/repo/${fullName}?refresh=1`}
                className="nb-link"
              >
                Re-scan
              </Link>
              .
            </>
          )}
        </p>
      </header>

      <SetupDoctorPanel report={setup} />

      <Section title="How to build and test it" subtitle="Commands marked CI are what a pull request must survive.">
        {analysis.commands.length === 0 ? (
          <Empty>No runnable commands were found in manifests, Makefile or CI.</Empty>
        ) : (
          <ul className="space-y-2">
            {analysis.commands.map((command) => (
              <li
                key={`${command.kind}:${command.command}`}
                className="nb-card p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="nb-chip nb-chip-mute">{COMMAND_LABELS[command.kind]}</span>
                  {command.fromCi && <span className="nb-chip nb-chip-positive">CI</span>}
                </div>
                <code className="mt-2 block overflow-x-auto font-mono text-sm font-bold">
                  {command.command}
                </code>
                <SourceLink href={command.source.url} label={command.source.path} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Entry points" subtitle="Where execution starts.">
          {analysis.entryPoints.length === 0 ? (
            <Empty>No conventional entry point was recognised.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {analysis.entryPoints.map((ref) => (
                <li key={ref.path}>
                  <a
                    href={ref.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="nb-link font-mono text-sm"
                  >
                    {ref.path}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Where things live" subtitle="Top-level directories by size and role.">
          <ul className="space-y-1.5">
            {analysis.keyDirectories.map((dir) => (
              <li key={dir.path} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-mono font-bold">{dir.path}/</span>
                <span className="text-xs font-bold text-muted">
                  {dir.role !== 'other' && `${dir.role} · `}
                  {dir.fileCount} files
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <ArchitectureMap
        graph={analysis.importGraph}
        htmlUrl={analysis.htmlUrl}
        defaultBranch={analysis.defaultBranch}
      />

      <Section title="House rules" subtitle="Extracted from CONTRIBUTING and the pull request template.">
        {analysis.contributorRules.length === 0 ? (
          <Empty>
            No contributor rules were found. Read recent merged pull requests to infer the norms.
          </Empty>
        ) : (
          <ul className="space-y-2">
            {analysis.contributorRules.map((rule) => (
              <li key={rule.id} className="nb-card p-3">
                <p className="text-sm font-black">{rule.label}</p>
                <p className="mt-1 text-sm font-semibold text-muted">{rule.detail}</p>
                <SourceLink href={rule.source.url} label={rule.source.path} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {analysis.notes.length > 0 && (
        <Section title="What this scan could not see">
          <ul className="list-disc space-y-1 pl-5 text-sm font-semibold text-muted">
            {analysis.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-2xl font-black">{title}</h2>
      {subtitle && <p className="text-sm font-semibold text-muted">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="nb-dashed p-4 text-sm font-semibold text-muted">{children}</p>
  );
}

function SourceLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="mt-2 inline-block font-mono text-xs font-bold text-muted underline underline-offset-2 hover:text-ink"
    >
      {label}
    </a>
  );
}
