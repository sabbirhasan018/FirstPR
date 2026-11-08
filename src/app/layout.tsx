import type { Metadata } from 'next';
import { Figtree, Geist_Mono } from 'next/font/google';
import Link from 'next/link';
import { AuthControls } from '@/components/auth-controls';
import { getSession } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/env';
import './globals.css';

const figtree = Figtree({ variable: '--font-figtree', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'FirstPR — evidence-backed open source contribution assistant',
  description:
    'Find the open source issue you can actually solve, understand the repo, and submit a high-quality pull request.',
};

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/evidence', label: 'Evidence' },
  { href: '/issues', label: 'Issues' },
  { href: '/preflight', label: 'Preflight' },
];

const REPO_URL = 'https://github.com/Niloy-Bhuiyan/FirstPR';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  return (
    <html lang="en">
      <body className={`${figtree.variable} ${geistMono.variable} font-sans antialiased`}>
        <div className="min-h-dvh">
          <header className="border-b-4 border-ink bg-background">
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
              <div className="flex min-w-0 items-baseline gap-3">
                <Link href="/" className="text-2xl font-black tracking-tight sm:text-3xl">
                  First<span className="text-accent">PR</span>
                </Link>
                <span className="hidden text-sm font-semibold text-muted sm:inline">
                  /evidence-backed
                </span>
              </div>

              <div className="flex items-center gap-3">
                <nav className="hidden items-center gap-1 md:flex">
                  {NAV.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="rounded-[4px] px-2.5 py-1.5 text-sm font-bold whitespace-nowrap hover:bg-primary"
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>

                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="hidden text-sm font-bold whitespace-nowrap sm:inline nb-link"
                >
                  GitHub
                </a>

                <AuthControls session={session} supabaseConfigured={isSupabaseConfigured()} />

                {/* Details/summary keeps the mobile menu working without client JS. */}
                <details className="relative md:hidden">
                  <summary className="nb-btn nb-btn-quiet list-none px-3.5 py-2.5 text-lg [&::-webkit-details-marker]:hidden">
                    <span aria-hidden>☰</span>
                    <span className="sr-only">Menu</span>
                  </summary>
                  <nav className="nb-card absolute right-0 z-20 mt-2 flex w-48 flex-col p-2">
                    {NAV.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="rounded-[4px] px-3 py-2 text-base font-bold hover:bg-primary"
                      >
                        {item.label}
                      </Link>
                    ))}
                    <a
                      href={REPO_URL}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="rounded-[4px] px-3 py-2 text-base font-bold hover:bg-primary"
                    >
                      GitHub ↗
                    </a>
                  </nav>
                </details>
              </div>
            </div>
          </header>

          {session?.mode === 'local' && (
            <p className="border-b-4 border-ink bg-warn px-4 py-2 text-center text-xs font-bold sm:px-6">
              Local mode — no Supabase credentials configured. Imports are kept in memory and are
              lost when the server restarts.
            </p>
          )}

          <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">{children}</main>

          <footer className="mx-auto max-w-5xl px-4 pb-12 text-xs font-semibold text-muted sm:px-6">
            Every skill shown is backed by a citation you can open. Nothing here is inferred by a
            language model.
          </footer>
        </div>
      </body>
    </html>
  );
}
