'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { discoverIssuesAction } from '@/app/issues/actions';
import { DISCOVER_INITIAL_STATE } from '@/app/issues/discover-state';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="nb-btn w-full text-lg"
    >
      {pending ? 'Searching and scoring…' : 'Find issues for me'}
    </button>
  );
}

export function DiscoverButton() {
  const [state, formAction] = useActionState(discoverIssuesAction, DISCOVER_INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <SubmitButton />
      <p className="text-sm font-semibold text-muted">
        Searches open, unassigned issues in your two strongest evidenced languages, then scores each
        repository. It checks your remaining GitHub budget first and spends at most half of it, so a
        run never leaves you stuck — with little quota it scores more repositories in less depth
        rather than failing. Repeat runs are mostly free, because unchanged responses are
        revalidated with ETags.
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
