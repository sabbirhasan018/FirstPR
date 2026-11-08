import { mapWithConcurrency } from '@/lib/concurrency';
import type { EvidenceReport } from '@/lib/evidence/types';
import { env } from '@/lib/env';
import { sharedResponseCache } from '@/lib/github/cache';
import { createGitHubClient, GitHubApiError, type GitHubClient } from '@/lib/github/client';
import {
  collectRepoHealth,
  ESSENTIAL_REQUESTS_PER_REPO,
  REQUESTS_PER_REPO,
  type ScanDepth,
} from '@/lib/health/collect';
import {
  checkRateLimit,
  describeReset,
  tokenAdvice,
  type RateLimitStatus,
} from '@/lib/github/rate-limit';
import { scoreRepoHealth } from '@/lib/health/engine';
import type { RepoHealth } from '@/lib/health/types';
import { searchIssuesByLanguage } from '@/lib/issues/collect';
import { rankIssues } from '@/lib/issues/matcher';
import type { IssueCandidate, IssueRanking } from '@/lib/issues/types';

/**
 * A run spends at most this share of the quota GitHub says is left, so one
 * discovery never leaves the user unable to do anything else for an hour.
 */
export const BUDGET_SHARE_OF_REMAINING = 0.5;

/** Ceiling on one run, so a 5,000/hour token is not drained by a single click. */
export const MAX_HEALTH_REQUEST_BUDGET = 400;

/** Used only when the preflight could not read the real budget. */
export const FALLBACK_HEALTH_REQUEST_BUDGET = 30;

/**
 * Repositories scanned in parallel. Kept small on purpose: GitHub enforces
 * secondary rate limits on bursts, and the win from 1 to 6 is most of the win
 * available. Scanning 44 repos sequentially took 3.7 minutes, nearly all of it
 * idle waiting on the network.
 */
export const REPO_SCAN_CONCURRENCY = 6;

/** Languages to search. More languages means more search requests. */
export const MAX_SEARCH_LANGUAGES = 2;

/** A language needs at least this much evidence before it is worth searching. */
export const MIN_LANGUAGE_SCORE = 25;

export type DiscoveryResult =
  | { ok: true; ranking: IssueRanking; health: RepoHealth[]; requestsUsed: number }
  | { ok: false; error: string };

export type DiscoverDeps = {
  evidence: EvidenceReport;
  client?: GitHubClient;
  /** The signed-in user's GitHub token; falls back to the server's. */
  githubToken?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
  healthRequestBudget?: number;
};

export async function discoverIssues(deps: DiscoverDeps): Promise<DiscoveryResult> {
  const languages = topLanguages(deps.evidence);
  if (languages.length === 0) {
    return {
      ok: false,
      error:
        'No language has enough evidence to search on yet. Import a GitHub profile with public code first.',
    };
  }

  const client =
    deps.client ??
    createGitHubClient({
      token: deps.githubToken ?? env().GITHUB_TOKEN,
      fetchImpl: deps.fetchImpl,
      cache: sharedResponseCache(),
    });

  try {
    // Free: /rate_limit does not count against the limit. Knowing the budget up
    // front is what turns "it died halfway through" into "here is what it can do".
    const limit = await checkRateLimit(client);
    if (limit && limit.coreRemaining === 0) {
      return {
        ok: false,
        error: `No GitHub requests left — ${describeReset(limit)}. ${tokenAdvice(limit)}`,
      };
    }

    const { candidates, warnings } = await searchIssuesByLanguage(languages, client);
    if (candidates.length === 0) {
      return { ok: false, error: 'GitHub returned no open, unassigned issues for your languages.' };
    }

    const budget = deps.healthRequestBudget ?? budgetFrom(limit);
    const { health, repoContext, skipped, rateLimited, depth } = await scoreRepos(
      candidates,
      client,
      budget,
      deps.now,
    );

    const ranking = rankIssues({
      candidates,
      evidence: deps.evidence,
      health,
      repoContext,
      now: deps.now,
    });

    ranking.notes.unshift(
      `Searched ${languages.join(' and ')} — the languages you have the strongest evidence in.`,
      ...warnings,
    );
    if (limit) {
      ranking.notes.push(
        `GitHub budget at the start of this run: ${limit.coreRemaining} of ${limit.coreLimit} requests, and ${describeReset(limit)}.` +
          (limit.anonymous ? ` ${tokenAdvice(limit)}` : ''),
      );
    }
    if (depth === 'essential' && health.size > 0) {
      ranking.notes.push(
        'Repositories were scored with the three highest-weight signals rather than all seven, so more of them could be covered on the available budget. Their scores are real but sit at about 65% coverage — shown per repo.',
      );
    }
    if (rateLimited) {
      ranking.notes.push(
        'GitHub’s rate limit ran out partway through scoring repositories. The ranking below is complete, but the repos scored after that point are treated as unknown. Set GITHUB_TOKEN to raise the limit from 60 to 5,000 requests per hour.',
      );
    }
    if (skipped > 0) {
      ranking.notes.push(
        `${skipped} repository(ies) went unscored${rateLimited ? '' : ' to stay inside the request budget'}; their issues are ranked with health treated as unknown, not as bad.`,
      );
    }

    return {
      ok: true,
      ranking,
      health: [...health.values()],
      requestsUsed: client.stats().requests,
    };
  } catch (error) {
    if (error instanceof GitHubApiError && error.isRateLimit) {
      const when = error.resetAt ? ` It resets at ${error.resetAt.toLocaleTimeString()}.` : '';
      return {
        ok: false,
        error: `GitHub's rate limit is exhausted.${when} Set GITHUB_TOKEN to raise it from 60 to 5,000 requests per hour.`,
      };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Issue discovery failed for an unknown reason.',
    };
  }
}

/**
 * Scale the budget to the quota actually available rather than to a constant.
 * With a token this affords a full scan of every candidate repo; anonymously it
 * degrades to a smaller, essential-depth scan instead of failing.
 */
function budgetFrom(limit: RateLimitStatus | null): number {
  if (!limit) return FALLBACK_HEALTH_REQUEST_BUDGET;
  return Math.min(
    MAX_HEALTH_REQUEST_BUDGET,
    Math.floor(limit.coreRemaining * BUDGET_SHARE_OF_REMAINING),
  );
}

/** The languages worth searching: strongest first, above the evidence floor. */
function topLanguages(evidence: EvidenceReport): string[] {
  return evidence.skills
    .filter((skill) => skill.category === 'language' && skill.score >= MIN_LANGUAGE_SCORE)
    .slice(0, MAX_SEARCH_LANGUAGES)
    .map((skill) => skill.label);
}

/**
 * Scores as many candidate repositories as the budget allows, most-represented
 * first — a repo with several matching issues is worth more per request spent.
 */
async function scoreRepos(
  candidates: IssueCandidate[],
  client: GitHubClient,
  budget: number,
  now: Date | undefined,
): Promise<{
  health: Map<string, RepoHealth>;
  repoContext: Map<string, { primaryLanguage: string | null; topics: string[] }>;
  skipped: number;
  rateLimited: boolean;
  depth: ScanDepth;
}> {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    counts.set(candidate.repoFullName, (counts.get(candidate.repoFullName) ?? 0) + 1);
  }

  const ordered = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([fullName]) => fullName);

  // Breadth beats depth here: an unscored repo contributes nothing to ranking,
  // while an essentially-scored one still clears the coverage floor. So if a full
  // scan cannot reach every candidate repo, drop to essential and cover more.
  const fullyAffordable = Math.floor(budget / REQUESTS_PER_REPO);
  const depth: ScanDepth = fullyAffordable >= ordered.length ? 'full' : 'essential';
  const perRepo = depth === 'full' ? REQUESTS_PER_REPO : ESSENTIAL_REQUESTS_PER_REPO;
  const affordable = Math.max(0, Math.floor(budget / perRepo));

  const targets = ordered.slice(0, affordable);
  let rateLimited = false;

  const scanned = await mapWithConcurrency(targets, REPO_SCAN_CONCURRENCY, async (fullName) => {
    // Once quota is gone, remaining workers stop rather than queue doomed calls.
    if (rateLimited) return null;
    try {
      const snapshot = await collectRepoHealth(fullName, client, depth);
      // Keyed by the name the issues reference, not the canonical name GitHub
      // returns — a renamed repo redirects, and the two would not match.
      return snapshot ? { key: fullName, snapshot } : null;
    } catch (error) {
      // Running out of quota mid-scan should cost the unscored repos their
      // health signal, not cost the user the whole ranking.
      if (error instanceof GitHubApiError && error.isRateLimit) {
        rateLimited = true;
        return null;
      }
      throw error;
    }
  });

  // Rebuilt in the original order so the output does not depend on which worker
  // happened to finish first.
  const health = new Map<string, RepoHealth>();
  const repoContext = new Map<string, { primaryLanguage: string | null; topics: string[] }>();
  for (const entry of scanned) {
    if (!entry) continue;
    health.set(entry.key, scoreRepoHealth(entry.snapshot, now));
    repoContext.set(entry.key, {
      primaryLanguage: entry.snapshot.primaryLanguage,
      topics: entry.snapshot.topics,
    });
  }

  return {
    health,
    repoContext,
    skipped: Math.max(0, ordered.length - health.size),
    rateLimited,
    depth,
  };
}
