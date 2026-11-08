'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase/server';

/**
 * The only GitHub scope requested is `read:user`.
 *
 * FirstPR reads public repositories, issues and pull requests, none of which
 * needs a scope at all — an authenticated token reaches public data regardless.
 * The scope exists so the profile can be identified. Asking for `public_repo`
 * would grant write access to every public repo the user can push to, which
 * this application has no business holding.
 */
const GITHUB_SCOPES = 'read:user';

export async function signInWithGitHub(): Promise<void> {
  const client = await getSupabaseServerClient();
  if (!client) {
    throw new Error('Sign-in requires Supabase credentials. The app is running in local mode.');
  }

  const origin = (await headers()).get('origin') ?? 'http://localhost:3000';

  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: `${origin}/auth/callback`,
      scopes: GITHUB_SCOPES,
    },
  });

  if (error || !data.url) {
    throw new Error(`Could not start GitHub sign-in: ${error?.message ?? 'no redirect URL'}`);
  }

  redirect(data.url);
}

export async function signOut(): Promise<void> {
  const client = await getSupabaseServerClient();
  await client?.auth.signOut();
  redirect('/');
}
