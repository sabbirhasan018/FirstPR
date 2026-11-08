import type { CheckStatus, SetupReport } from '@/lib/setup/doctor';

const STATUS_STYLE: Record<CheckStatus, string> = {
  ok: 'nb-chip-positive',
  'wrong-version': 'nb-chip-warn',
  missing: 'nb-chip-danger',
  unknown: 'nb-chip-mute',
};

const STATUS_LABEL: Record<CheckStatus, string> = {
  ok: 'ok',
  'wrong-version': 'version',
  missing: 'missing',
  unknown: 'unchecked',
};

export function SetupDoctorPanel({ report }: { report: SetupReport }) {
  return (
    <section aria-labelledby="setup-doctor">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="setup-doctor" className="text-2xl font-black">
          Setup Doctor
        </h2>
        <span
          className={`nb-chip ${report.ready ? STATUS_STYLE.ok : STATUS_STYLE['wrong-version']}`}
        >
          {report.ready ? 'this machine looks ready' : 'action needed'}
        </span>
      </div>
      <p className="text-sm font-semibold text-muted">
        Checks your machine against what the repository says it needs. Only a fixed list of version
        commands is ever run — nothing from the repository is executed.
      </p>

      <ul className="mt-3 space-y-2">
        {report.checks.map((check) => (
          <li key={check.tool} className="nb-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-black">{check.tool}</span>
              <span className={`nb-chip ${STATUS_STYLE[check.status]}`}>
                {STATUS_LABEL[check.status]}
              </span>
              {check.required && (
                <span className="text-xs font-bold text-muted">needs {check.required}</span>
              )}
            </div>
            <p className="mt-1 text-sm font-semibold text-muted">{check.message}</p>
            {check.fix && <p className="mt-1 text-sm font-semibold">{check.fix}</p>}
          </li>
        ))}
      </ul>

      {report.notes.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs font-semibold text-muted">
          {report.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
