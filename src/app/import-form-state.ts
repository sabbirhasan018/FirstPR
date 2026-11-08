/**
 * Lives outside actions.ts because a 'use server' module may only export async
 * functions — exporting the initial-state object from there is a runtime error.
 */
export type ImportFormState = {
  status: 'idle' | 'error' | 'success';
  message: string;
};

export const IMPORT_INITIAL_STATE: ImportFormState = { status: 'idle', message: '' };
