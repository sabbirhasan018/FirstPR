import { mapWithConcurrency } from '@/lib/concurrency';
import { env } from '@/lib/env';
import { sharedResponseCache } from '@/lib/github/cache';
import { createGitHubClient, GitHubApiError, type GitHubClient } from '@/lib/github/client';
import { analyzeRepo } from '@/lib/repo/analyze';
import { collectRepoAnalysis } from '@/lib/repo/collect';
import type { RepoAnalysis } from '@/lib/repo/types';
import { runSetupDoctor, type DoctorDeps, type SetupReport } from '@/lib/setup/doctor';

/**
 * Repo analysis is derived from public data and is identical for every user, so
 * it is cached process-wide rather than stored per user behind RLS. Putting it
 * in a user-scoped table would multiply identical rows by the number of users
 * and imply an ownership that does not exist.
 */
const globalForAnalysis = globalThis as unknown as {
  __firstprRepoAnalyses?: Map<string, RepoAnalysis>;
};

function analysisCache(): Map<string, RepoAnalysis> {
  globalForAnalysis.__firstprRepoAnalyses ??= new Map();
  return globalForAnalysis.__firstprRepoAnalyses;
}

export type AnalyzeResult =
  | { ok: true; analysis: RepoAnalysis; setup: SetupReport; cached: boolean }
  | { ok: false; error: string };

export type AnalyzeDeps = {
  githubToken?: string;
  client?: GitHubClient;
  fetchImpl?: typeof fetch;
  /** Skip the process cache, e.g. when the user asks for a re-scan. */
  refresh?: boolean;
  /** Injected in tests so they never spawn real processes. */
  doctor?: DoctorDeps;
};

/** `owner/name`, matching GitHub's own naming rules. */
const FULL_NAME = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/;

export async function analyzeRepository(
  fullName: string,
  deps: AnalyzeDeps = {},
): Promise<AnalyzeResult> {
  if (!FULL_NAME.test(fullName)) {
    return { ok: false, error: `"${fullName}" is not a valid owner/repository name.` };
  }

  const cache = analysisCache();
  const cached = !deps.refresh ? cache.get(fullName) : undefined;
  if (cached) {
    return { ok: true, analysis: cached, setup: await runSetupDoctor(cached, deps.doctor), cached: true };
  }

  const client =
    deps.client ??
    createGitHubClient({
      token: deps.githubToken ?? env().GITHUB_TOKEN,
      fetchImpl: deps.fetchImpl,
      cache: sharedResponseCache(),
    });

  try {
    const snapshot = await collectRepoAnalysis(fullName, client);
    if (!snapshot) {
      return { ok: false, error: `Repository "${fullName}" was not found, or is not public.` };
    }

    const analysis = analyzeRepo(snapshot);
    cache.set(fullName, analysis);

    return { ok: true, analysis, setup: await runSetupDoctor(analysis, deps.doctor), cached: false };
  } catch (error) {
    if (error instanceof GitHubApiError && error.isRateLimit) {
      return {
        ok: false,
        error:
          'GitHub’s rate limit is exhausted, so this repository could not be read. Sign in with GitHub, or set GITHUB_TOKEN, to raise it.',
      };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Analysis failed for an unknown reason.',
    };
  }
}

/** Analyses several repositories, bounded like every other fan-out here. */
export async function analyzeRepositories(
  fullNames: string[],
  deps: AnalyzeDeps = {},
): Promise<AnalyzeResult[]> {
  return mapWithConcurrency(fullNames, 4, (fullName) => analyzeRepository(fullName, deps));
}
