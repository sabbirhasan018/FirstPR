import { isSupabaseConfigured } from '@/lib/env';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export type AppSession = {
  userId: string;
  githubLogin: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /**
   * 'supabase' means a real authenticated user. 'local' is the credential-free
   * development identity — never treat it as an authenticated principal.
   */
  mode: 'supabase' | 'local';
  /**
   * The user's own GitHub token from the OAuth grant. This is the whole point of
   * signing in with GitHub: requests are then billed to the user's 5,000/hour
   * rather than to a shared pool. Null in local mode or when the provider token
   * is unavailable, in which case the server's GITHUB_TOKEN is used instead.
   */
  githubToken: string | null;
};

/** Stable id for local mode so in-memory data survives navigation. */
export const LOCAL_USER_ID = '00000000-0000-4000-8000-000000000001';

const LOCAL_SESSION: AppSession = {
  userId: LOCAL_USER_ID,
  githubLogin: null,
  displayName: 'Local developer',
  avatarUrl: null,
  mode: 'local',
  githubToken: null,
};

/**
 * Returns the current session, or null when Supabase is configured but nobody
 * is signed in. In local mode it always returns the development identity.
 */
export async function getSession(): Promise<AppSession | null> {
  if (!isSupabaseConfigured()) return LOCAL_SESSION;

  const client = await getSupabaseServerClient();
  if (!client) return LOCAL_SESSION;

  // getUser() revalidates against Supabase, so it is the trustworthy source for
  // identity. getSession() reads the cookie without revalidating, but it is the
  // only place the GitHub provider token is exposed — so identity comes from
  // the former and the token from the latter.
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;

  const { data: sessionData } = await client.auth.getSession();
  const providerToken = sessionData.session?.provider_token ?? null;

  const meta = data.user.user_metadata ?? {};
  return {
    userId: data.user.id,
    githubLogin: typeof meta.user_name === 'string' ? meta.user_name : null,
    displayName: typeof meta.full_name === 'string' ? meta.full_name : data.user.email ?? null,
    avatarUrl: typeof meta.avatar_url === 'string' ? meta.avatar_url : null,
    mode: 'supabase',
    githubToken: providerToken,
  };
}
