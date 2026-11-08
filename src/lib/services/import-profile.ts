import { z } from 'zod';
import { deriveEvidence } from '@/lib/evidence/engine';
import { env } from '@/lib/env';
import { sharedResponseCache } from '@/lib/github/cache';
import { createGitHubClient, GitHubApiError } from '@/lib/github/client';
import { collectProfile, ProfileNotFoundError } from '@/lib/github/collect';
import type { EvidenceStore, StoredImport } from '@/lib/store/types';

/** GitHub's own rule: alphanumerics and single hyphens, max 39 characters. */
export const githubLoginSchema = z
  .string()
  .trim()
  .min(1, 'Enter a GitHub username.')
  .max(39, 'GitHub usernames are at most 39 characters.')
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/,
    'That is not a valid GitHub username.',
  );

export type ImportResult =
  | { ok: true; record: StoredImport }
  | { ok: false; error: string };

export type ImportDeps = {
  store: EvidenceStore;
  userId: string;
  /** The signed-in user's GitHub token; falls back to the server's. */
  githubToken?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
  deepScanLimit?: number;
};

/**
 * Import a GitHub profile, derive evidence from it and persist both.
 * Expected failures (bad username, unknown user, rate limit) come back as
 * `ok: false` with a message meant for the user, not as thrown errors.
 */
export async function importProfile(rawLogin: string, deps: ImportDeps): Promise<ImportResult> {
  const parsed = githubLoginSchema.safeParse(rawLogin);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const login = parsed.data;

  const client = createGitHubClient({
    token: deps.githubToken ?? env().GITHUB_TOKEN,
    fetchImpl: deps.fetchImpl,
    cache: sharedResponseCache(),
  });

  try {
    const snapshot = await collectProfile(login, client, {
      now: deps.now,
      deepScanLimit: deps.deepScanLimit,
    });
    const report = deriveEvidence(snapshot, deps.now ?? new Date());
    const record = await deps.store.saveImport({
      userId: deps.userId,
      githubLogin: snapshot.login,
      snapshot,
      report,
    });
    return { ok: true, record };
  } catch (error) {
    if (error instanceof ProfileNotFoundError) {
      return { ok: false, error: error.message };
    }
    if (error instanceof GitHubApiError && error.isRateLimit) {
      const when = error.resetAt ? ` It resets at ${error.resetAt.toLocaleTimeString()}.` : '';
      return {
        ok: false,
        error: `GitHub's rate limit is exhausted.${when} Set GITHUB_TOKEN to raise it from 60 to 5,000 requests per hour.`,
      };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The import failed for an unknown reason.',
    };
  }
}
