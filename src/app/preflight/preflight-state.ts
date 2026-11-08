import type { Draft } from '@/lib/drafts/compose';
import type { PreflightReport } from '@/lib/preflight/types';

/** Separate module: a 'use server' file may only export async functions. */
export type PreflightFormState = {
  status: 'idle' | 'error' | 'ready';
  message: string;
  report: PreflightReport | null;
  drafts: Draft[];
};

export const PREFLIGHT_INITIAL_STATE: PreflightFormState = {
  status: 'idle',
  message: '',
  report: null,
  drafts: [],
};
