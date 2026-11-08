'use server';

import { revalidatePath } from 'next/cache';
import { resolveGitHubToken } from '@/lib/auth/github-token';
import { getSession } from '@/lib/auth/session';
import { importProfile } from '@/lib/services/import-profile';
import { getStore } from '@/lib/store';

import type { ImportFormState } from './import-form-state';

export async function importProfileAction(
  _previous: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  const session = await getSession();
  if (!session) {
    return { status: 'error', message: 'Sign in before importing a profile.' };
  }

  const result = await importProfile(String(formData.get('login') ?? ''), {
    store: await getStore(),
    userId: session.userId,
    githubToken: resolveGitHubToken(session).token,
  });

  if (!result.ok) {
    return { status: 'error', message: result.error };
  }

  revalidatePath('/');
  revalidatePath('/evidence');

  const { report, snapshot } = result.record;
  return {
    status: 'success',
    message: `Imported ${snapshot.login}: ${report.skills.length} skills evidenced across ${snapshot.repos.length} scanned repos.`,
  };
}
