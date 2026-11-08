import Link from 'next/link';
import type { RepoHealth } from '@/lib/health/types';
import type { RankedIssue, ReasonEffect } from '@/lib/issues/types';

const EFFECT_MARK: Record<ReasonEffect, string> = {
  boost: '▲',
  penalty: '▼',
  neutral: '–',
};

const EFFECT_STYLE: Record<ReasonEffect, string> = {
  boost: 'text-ink',
  penalty: 'text-accent',
  neutral: 'text-muted',
};

const BAND_STYLE: Record<RepoHealth['band'], string> = {
  healthy: 'nb-chip-positive',
  mixed: 'nb-chip-warn',
  risky: 'nb-chip-danger',
  'insufficient-data': 'nb-chip-mute',
};

export function IssueCard({ entry, health }: { entry: RankedIssue; health?: RepoHealth }) {
  const { issue } = entry;

  return (
    <article className="nb-card p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <a href={issue.url} target="_blank" rel="noreferrer noopener" className="nb-link text-lg">
            {issue.title}
          </a>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-xs font-bold text-muted">
            <span className="truncate">
              {issue.repoFullName}#{issue.number}
            </span>
            <Link href={`/repo/${issue.repoFullName}`} className="nb-link whitespace-nowrap">
              understand this repo
            </Link>
          </p>
        </div>
        <span className="nb-chip shrink-0 font-mono">{entry.score}/100</span>
      </header>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {health && (
          <span className={`nb-chip ${BAND_STYLE[health.band]}`}>
            repo: {health.band === 'insufficient-data' ? 'unscored' : health.band}
            {health.survivalScore !== null && ` ${health.survivalScore}`}
          </span>
        )}
        {entry.matchedSkills.map((skill) => (
          <span key={skill} className="nb-chip nb-chip-mute">
            {skill}
          </span>
        ))}
        {issue.labels.slice(0, 3).map((label) => (
          <span key={label} className="nb-chip">
            {label}
          </span>
        ))}
      </div>

      <ul className="mt-3 space-y-1.5">
        {entry.reasons.map((reason) => (
          <li key={reason.label} className="flex gap-2 text-xs">
            <span className={`shrink-0 font-mono font-bold ${EFFECT_STYLE[reason.effect]}`}>
              {EFFECT_MARK[reason.effect]}
            </span>
            <span>
              <span className="font-extrabold">{reason.label}:</span>{' '}
              <span className="font-semibold text-muted">{reason.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}
