import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env, isSupabaseConfigured } from '@/lib/env';

/**
 * Request-scoped Supabase client carrying the user's session cookies, so every
 * query runs as that user and RLS applies. Returns null in local mode.
 */
export async function getSupabaseServerClient() {
  if (!isSupabaseConfigured()) return null;

  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = env();
  const cookieStore = await cookies();

  return createServerClient(NEXT_PUBLIC_SUPABASE_URL!, NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Session refresh is handled by middleware instead.
        }
      },
    },
  });
}
