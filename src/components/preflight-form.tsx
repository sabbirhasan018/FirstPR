'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { runPreflightAction } from '@/app/preflight/actions';
import { PREFLIGHT_INITIAL_STATE } from '@/app/preflight/preflight-state';
import type { CheckOutcome, CheckSeverity } from '@/lib/preflight/types';

const STYLE = {
  pass: 'nb-chip-positive',
  blocker: 'nb-chip-danger',
  warning: 'nb-chip-warn',
  skipped: 'nb-chip-mute',
} as const;

function badge(outcome: CheckOutcome, severity: CheckSeverity) {
  if (outcome === 'pass') return { style: STYLE.pass, label: 'pass' };
  if (outcome === 'skipped') return { style: STYLE.skipped, label: 'n/a' };
  return severity === 'blocker'
    ? { style: STYLE.blocker, label: 'blocker' }
    : { style: STYLE.warning, label: 'fix first' };
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="nb-btn w-full text-lg"
    >
      {pending ? 'Checking…' : 'Run preflight'}
    </button>
  );
}

const FIELD = 'nb-input';

export function PreflightForm({ defaultRepoPath }: { defaultRepoPath?: string }) {
  const [state, formAction] = useActionState(runPreflightAction, PREFLIGHT_INITIAL_STATE);

  return (
    <div className="space-y-6">
      <form
        action={formAction}
        className="nb-panel space-y-5 p-5 sm:p-8"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-extrabold">Local repository path</span>
            <input
              name="repoPath"
              required
              defaultValue={defaultRepoPath}
              className={`mt-1 ${FIELD}`}
            />
          </label>
          <label className="block text-sm">
            <span className="font-extrabold">Base branch</span>
            <input name="baseBranch" placeholder="main" className={`mt-1 ${FIELD}`} />
          </label>
        </div>

        <label className="block text-sm">
          <span className="font-extrabold">Pull request title</span>
          <input name="prTitle" className={`mt-1 ${FIELD}`} />
        </label>

        <label className="block text-sm">
          <span className="font-extrabold">Pull request description</span>
          <textarea name="prBody" rows={5} className={`mt-1 ${FIELD}`} />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-extrabold">Issue this closes</span>
            <input
              name="linkedIssue"
              placeholder="123"
              inputMode="numeric"
              className={`mt-1 ${FIELD}`}
            />
          </label>
          <fieldset className="text-sm">
            <legend className="font-extrabold">This repository requires</legend>
            <div className="mt-2 space-y-2">
              <label className="flex items-center gap-2.5 font-semibold">
                <input type="checkbox" name="rules" value="dco" className="nb-check" /> sign-off
                (DCO)
              </label>
              <label className="flex items-center gap-2.5 font-semibold">
                <input
                  type="checkbox"
                  name="rules"
                  value="conventional-commits"
                  className="nb-check"
                />{' '}
                conventional commits
              </label>
              <label className="flex items-center gap-2.5 font-semibold">
                <input
                  type="checkbox"
                  name="hasTestCommand"
                  defaultChecked
                  className="nb-check"
                />{' '}
                has a test suite
              </label>
            </div>
          </fieldset>
        </div>

        <SubmitButton />
        <p className="text-sm font-semibold text-muted">
          Runs read-only git commands against the path you give. Nothing is written, pushed or
          posted.
        </p>

        {state.status === 'error' && (
          <p
            role="status"
            className="nb-card-flat bg-accent px-3 py-2 text-sm font-bold text-background"
          >
            {state.message}
          </p>
        )}
      </form>

      {state.report && (
        <section aria-labelledby="preflight-results">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="preflight-results" className="text-2xl font-black">
              Results
            </h2>
            <span className="text-xs font-bold text-muted">{state.message}</span>
          </div>
          <p
            className={`nb-card-flat mt-3 px-3 py-2 text-sm font-bold ${
              state.report.readyToOpen ? 'bg-positive' : 'bg-accent text-background'
            }`}
          >
            {state.report.summary}
          </p>

          <ul className="mt-3 space-y-2">
            {state.report.checks.map((check) => {
              const { style, label } = badge(check.outcome, check.severity);
              return (
                <li key={check.id} className="nb-card p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-black">{check.label}</span>
                    <span className={`nb-chip ${style}`}>{label}</span>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-muted">{check.detail}</p>
                  {check.fix && <p className="mt-1 text-sm font-semibold">{check.fix}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {state.drafts.length > 0 && (
        <section aria-labelledby="drafts">
          <h2 id="drafts" className="text-2xl font-black">
            Drafts
          </h2>
          <p className="text-sm font-semibold text-muted">
            Scaffolds with your own facts filled in. Angle-bracket placeholders are deliberate — a
            draft that invents reasoning you never had is worse than no draft. Nothing is posted
            anywhere.
          </p>

          <div className="mt-3 space-y-3">
            {state.drafts.map((item) => (
              <details key={item.kind} className="nb-card p-3">
                <summary className="cursor-pointer text-sm font-black">
                  {item.title}
                  {item.placeholders.length > 0 && (
                    <span className="ml-2 text-xs font-bold text-muted">
                      {item.placeholders.length} to fill in
                    </span>
                  )}
                </summary>
                <p className="mt-2 text-xs font-semibold text-muted">{item.rationale}</p>
                <pre className="mt-2 overflow-x-auto rounded-[4px] border-2 border-ink bg-background p-3 text-xs whitespace-pre-wrap">
                  {item.body}
                </pre>
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
