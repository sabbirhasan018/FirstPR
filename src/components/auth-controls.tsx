import { signInWithGitHub, signOut } from '@/app/auth/actions';
import type { AppSession } from '@/lib/auth/session';

/**
 * Sign-in is the moment the rate limit stops mattering: the user's own GitHub
 * token comes with the grant, so their requests draw on their 5,000/hour rather
 * than a shared pool. Nobody has to create or paste a token.
 */
export function AuthControls({
  session,
  supabaseConfigured,
}: {
  session: AppSession | null;
  supabaseConfigured: boolean;
}) {
  if (!supabaseConfigured) return null;

  if (!session) {
    return (
      <form action={signInWithGitHub}>
        <button
          type="submit"
          className="nb-btn nb-btn-quiet whitespace-nowrap"
        >
          Sign in with GitHub
        </button>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {session.avatarUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- avatar host is not configured for next/image
        <img
          src={session.avatarUrl}
          alt=""
          width={32}
          height={32}
          className="rounded-full border-[3px] border-ink"
        />
      )}
      <span className="hidden text-sm font-bold sm:inline">
        {session.githubLogin ?? session.displayName}
      </span>
      <form action={signOut}>
        <button type="submit" className="nb-btn nb-btn-quiet">
          Sign out
        </button>
      </form>
    </div>
  );
}
