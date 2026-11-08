import { GitHubApiError, type GitHubClient } from '@/lib/github/client';
import {
  communityProfileSchema,
  issueListSchema,
  pullRequestListSchema,
  releaseSchema,
  repoDetailSchema,
  workflowRunsSchema,
} from '@/lib/github/discovery-schemas';
import type { RepoHealthSnapshot } from './types';

/** Requests a full health scan costs when nothing is cached. */
export const REQUESTS_PER_REPO = 7;

/**
 * Requests an essential scan costs: repo detail, closed PRs, issues.
 *
 * Those three carry 0.65 of the total signal weight — comfortably above the
 * scorer's 0.5 coverage floor — so an essential scan still produces a real
 * score, just an honestly less complete one. Under a tight budget, scoring
 * eleven repos at 65% coverage beats scoring five at 100%, because an unscored
 * repo contributes nothing to ranking at all.
 */
export const ESSENTIAL_REQUESTS_PER_REPO = 3;

export type ScanDepth = 'full' | 'essential';

/**
 * Reads the observable maintenance behaviour of one repository.
 *
 * Each endpoint is optional: if one fails, its name is recorded in
 * `unavailable` and the scorer drops that signal's weight rather than treating
 * the absence as a bad score.
 */
export async function collectRepoHealth(
  fullName: string,
  client: GitHubClient,
  depth: ScanDepth = 'full',
): Promise<RepoHealthSnapshot | null> {
  const detail = await client.get(`/repos/${fullName}`, repoDetailSchema);
  if (!detail) return null;

  const unavailable: string[] = [];
  const essentialOnly = depth === 'essential';

  const closedPrs = await optional(
    () =>
      client.get(
        `/repos/${fullName}/pulls?state=closed&sort=updated&direction=desc&per_page=20`,
        pullRequestListSchema,
      ),
    'closed pull requests',
    unavailable,
  );

  const openPrs = essentialOnly
    ? skipped('open pull requests', unavailable)
    : await optional(
        () =>
          client.get(
            `/repos/${fullName}/pulls?state=open&sort=updated&direction=desc&per_page=20`,
            pullRequestListSchema,
          ),
        'open pull requests',
        unavailable,
      );

  const issues = await optional(
    () =>
      client.get(
        `/repos/${fullName}/issues?state=all&sort=created&direction=desc&per_page=20`,
        issueListSchema,
      ),
    'issues',
    unavailable,
  );

  const release = essentialOnly
    ? skipped('latest release', unavailable)
    : await optional(
        () => client.get(`/repos/${fullName}/releases/latest`, releaseSchema),
        'latest release',
        unavailable,
      );

  const runs = essentialOnly
    ? skipped('CI runs', unavailable)
    : await optional(
        () => client.get(`/repos/${fullName}/actions/runs?per_page=20`, workflowRunsSchema),
        'CI runs',
        unavailable,
      );

  const community = essentialOnly
    ? skipped('community profile', unavailable)
    : await optional(
        () => client.get(`/repos/${fullName}/community/profile`, communityProfileSchema),
        'community profile',
        unavailable,
      );

  return {
    fullName: detail.full_name,
    htmlUrl: detail.html_url,
    description: detail.description,
    stars: detail.stargazers_count,
    isArchived: detail.archived,
    isFork: detail.fork,
    pushedAt: detail.pushed_at ?? detail.created_at,
    createdAt: detail.created_at,
    openIssueCount: detail.open_issues_count,
    primaryLanguage: detail.language,
    topics: detail.topics,
    license: detail.license?.spdx_id ?? null,
    closedPullRequests: (closedPrs ?? []).map((pr) => ({
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      mergedAt: pr.merged_at,
    })),
    openPullRequests: (openPrs ?? []).map((pr) => ({
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      mergedAt: null,
    })),
    // GitHub's issues endpoint returns pull requests too; they are not issues.
    recentIssues: (issues ?? [])
      .filter((issue) => issue.pull_request === undefined)
      .map((issue) => ({
        createdAt: issue.created_at,
        closedAt: issue.closed_at,
        commentCount: issue.comments,
      })),
    latestReleaseAt: release?.published_at ?? null,
    workflowRuns: (runs?.workflow_runs ?? []).map((run) => ({
      conclusion: run.conclusion,
      createdAt: run.created_at,
    })),
    hasContributingDoc: community?.files.contributing != null,
    hasIssueTemplates: community?.files.issue_template != null,
    unavailable,
  };
}

/**
 * Records a signal as unavailable without spending a request on it. The scorer
 * then drops its weight, so a cheap scan reads as lower coverage rather than as
 * a worse repository.
 */
function skipped(name: string, unavailable: string[]): null {
  unavailable.push(name);
  return null;
}

/**
 * Runs an optional request, recording rather than throwing on failure.
 * A rate limit is rethrown, because continuing would waste the caller's time
 * producing snapshots with no data in them.
 */
async function optional<T>(
  run: () => Promise<T | null>,
  name: string,
  unavailable: string[],
): Promise<T | null> {
  try {
    const result = await run();
    if (result === null) unavailable.push(name);
    return result;
  } catch (error) {
    if (error instanceof GitHubApiError && error.isRateLimit) throw error;
    unavailable.push(name);
    return null;
  }
}
