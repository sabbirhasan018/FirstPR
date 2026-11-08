import type { SkillEvidence } from '@/lib/evidence/types';

const CONFIDENCE_STYLES: Record<SkillEvidence['confidence'], string> = {
  strong: 'nb-chip-positive',
  moderate: 'nb-chip-warn',
  weak: 'nb-chip-mute',
};

/**
 * Cards rather than a table: the citation list is variable-length, and this
 * layout works at 375px without horizontal scrolling.
 */
export function SkillCard({ skill }: { skill: SkillEvidence }) {
  return (
    <article className="nb-card p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-black">{skill.label}</h3>
        <div className="flex items-center gap-2">
          <span className={`nb-chip ${CONFIDENCE_STYLES[skill.confidence]}`}>
            {skill.confidence}
          </span>
          <span className="font-mono text-sm font-bold">{skill.score}/100</span>
        </div>
      </header>

      <p className="mt-2 text-sm font-semibold text-muted">{skill.rationale}</p>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        {(['breadth', 'freshness', 'depth'] as const).map((part) => (
          <div key={part} className="rounded-[4px] border-2 border-ink bg-surface px-2 py-1.5">
            <dt className="font-bold text-muted capitalize">{part}</dt>
            <dd className="font-mono font-bold">{skill[part].toFixed(2)}</dd>
          </div>
        ))}
      </dl>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-bold">
          {skill.citations.length} citation{skill.citations.length === 1 ? '' : 's'}
        </summary>
        <ul className="mt-2 space-y-1.5">
          {skill.citations.map((citation) => (
            <li key={`${citation.repo}:${citation.kind}:${citation.detail}`} className="text-xs">
              <a
                href={citation.url}
                target="_blank"
                rel="noreferrer noopener"
                className="nb-link"
              >
                {citation.repo}
              </a>
              <span className="font-semibold text-muted"> — {citation.detail}</span>
              <span className="nb-chip nb-chip-mute ml-1 font-mono text-[10px]">
                {citation.kind}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}
