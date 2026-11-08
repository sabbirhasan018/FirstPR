/** Separate from actions.ts: a 'use server' module may only export functions. */
export type DiscoverFormState = {
  status: 'idle' | 'error' | 'success';
  message: string;
};

export const DISCOVER_INITIAL_STATE: DiscoverFormState = { status: 'idle', message: '' };
