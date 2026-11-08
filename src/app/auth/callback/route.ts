import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

/**
 * OAuth redirect target. Supabase sends the user back here with a one-time
 * code, which is exchanged for a session. The exchange also yields the GitHub
 * provider token, which Supabase stores in the session cookie — that is what
 * lets later requests run against the user's own rate limit.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const oauthError = url.searchParams.get('error_description') ?? url.searchParams.get('error');

  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/?auth_error=${encodeURIComponent(oauthError)}`, url.origin),
    );
  }

  if (!code) {
    return NextResponse.redirect(new URL('/?auth_error=missing_code', url.origin));
  }

  const client = await getSupabaseServerClient();
  if (!client) {
    return NextResponse.redirect(new URL('/?auth_error=supabase_not_configured', url.origin));
  }

  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(`/?auth_error=${encodeURIComponent(error.message)}`, url.origin),
    );
  }

  return NextResponse.redirect(new URL('/', url.origin));
}
