'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { importProfileAction } from '@/app/actions';
import { IMPORT_INITIAL_STATE } from '@/app/import-form-state';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="nb-btn w-full text-lg">
      {pending ? 'Scanning…' : 'Find my evidence'}
    </button>
  );
}

export function ImportForm({ defaultLogin }: { defaultLogin?: string }) {
  const [state, formAction] = useActionState(importProfileAction, IMPORT_INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label htmlFor="login" className="text-base font-extrabold">
        GitHub username
      </label>
      <input
        id="login"
        name="login"
        required
        defaultValue={defaultLogin}
        placeholder="e.g. torvalds"
        autoComplete="off"
        spellCheck={false}
        aria-describedby="import-help"
        className="nb-input"
      />
      <SubmitButton />
      <p id="import-help" className="text-sm font-semibold text-muted">
        Reads public repositories only. A scan costs roughly 30 GitHub API requests, so without a
        GITHUB_TOKEN you get about two per hour.
      </p>

      {state.status !== 'idle' && (
        <p
          role="status"
          className={`nb-card-flat px-3 py-2 text-sm font-bold ${
            state.status === 'error' ? 'bg-accent text-background' : 'bg-positive'
          }`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
