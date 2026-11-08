import { z } from 'zod';
import { MANIFEST_PATHS } from '@/lib/evidence/manifests';
import { GitHubApiError, type GitHubClient } from './client';
import {
  gitHubContentSchema,
  gitHubLanguagesSchema,
  gitHubPrSearchSchema,
  gitHubRepoSchema,
  gitHubTreeSchema,
  gitHubUserSchema,
  type GitHubRepo,
  type Manifest,
  type ProfileSnapshot,
  type RepoSnapshot,
} from './types';

/**
 * How many repos get a deep scan (languages + file tree + manifests). Each deep
 * scan costs roughly 2-4 API requests, and unauthenticated callers only get 60
 * per hour, so this is deliberately small.
 */
export const DEFAULT_DEEP_SCAN_LIMIT = 12;

export class ProfileNotFoundError extends Error {
  constructor(login: string) {
    super(`GitHub user "${login}" was not found.`);
    this.name = 'ProfileNotFoundError';
  }
}

export type CollectOptions = {
  deepScanLimit?: number;
  now?: Date;
};

export async function collectProfile(
  login: string,
  client: GitHubClient,
  options: CollectOptions = {},
): Promise<ProfileSnapshot> {
  const deepScanLimit = options.deepScanLimit ?? DEFAULT_DEEP_SCAN_LIMIT;
  const now = options.now ?? new Date();
  const warnings: string[] = [];

  const user = await client.get(`/users/${encodeURIComponent(login)}`, gitHubUserSchema);
  if (!user) throw new ProfileNotFoundError(login);

  const repoList =
    (await client.get(
      `/users/${encodeURIComponent(login)}/repos?per_page=100&sort=pushed&type=owner`,
      z.array(gitHubRepoSchema),
    )) ?? [];

  const scannable = repoList
    .filter((repo): repo is GitHubRepo & { pushed_at: string } => repo.pushed_at !== null)
    .slice(0, deepScanLimit);

  if (repoList.length > scannable.length) {
    warnings.push(
      `Scanned the ${scannable.length} most recently pushed repos of ${repoList.length}; older repos were skipped.`,
    );
  }

  const repos: RepoSnapshot[] = [];
  for (const repo of scannable) {
    try {
      repos.push(await scanRepo(repo, client));
    } catch (error) {
      if (error instanceof GitHubApiError && error.isRateLimit) {
        warnings.push(rateLimitMessage(error));
        break;
      }
      warnings.push(`Could not fully scan ${repo.full_name}: ${describe(error)}`);
    }
  }

  const { mergedPullRequests, mergedPullRequestTotal } = await collectMergedPrs(
    login,
    client,
    warnings,
  );

  return {
    login: user.login,
    name: user.name,
    avatarUrl: user.avatar_url,
    htmlUrl: user.html_url,
    bio: user.bio,
    publicRepos: user.public_repos,
    followers: user.followers,
    accountCreatedAt: user.created_at,
    collectedAt: now.toISOString(),
    repos,
    mergedPullRequests,
    mergedPullRequestTotal,
    warnings,
  };
}

async function scanRepo(
  repo: GitHubRepo & { pushed_at: string },
  client: GitHubClient,
): Promise<RepoSnapshot> {
  const languageBytes =
    (await client.get(`/repos/${repo.full_name}/languages`, gitHubLanguagesSchema)) ?? {};

  const tree = await readTree(repo, client);

  const filePaths = (tree?.tree ?? []).filter((node) => node.type === 'blob').map((node) => node.path);
  const manifests = await fetchRootManifests(repo.full_name, filePaths, client);

  return {
    fullName: repo.full_name,
    htmlUrl: repo.html_url,
    description: repo.description,
    isFork: repo.fork,
    isArchived: repo.archived,
    stars: repo.stargazers_count,
    pushedAt: repo.pushed_at,
    createdAt: repo.created_at,
    topics: repo.topics,
    primaryLanguage: repo.language,
    languageBytes,
    filePaths,
    treeTruncated: tree?.truncated ?? false,
    manifests,
  };
}

/**
 * GitHub answers 409 for a repository with no commits on the branch. That is a
 * fact about the repo, not a failure, so it yields an empty tree instead of a
 * warning that would otherwise drown out the real gaps.
 */
async function readTree(repo: GitHubRepo & { pushed_at: string }, client: GitHubClient) {
  try {
    return await client.get(
      `/repos/${repo.full_name}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`,
      gitHubTreeSchema,
    );
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 409) return null;
    throw error;
  }
}

/** Only fetch manifests the tree already told us exist, at the repo root. */
async function fetchRootManifests(
  fullName: string,
  filePaths: string[],
  client: GitHubClient,
): Promise<Manifest[]> {
  const present = MANIFEST_PATHS.filter((path) => filePaths.includes(path));
  const manifests: Manifest[] = [];

  for (const path of present) {
    const file = await client.get(`/repos/${fullName}/contents/${path}`, gitHubContentSchema);
    if (!file || file.encoding !== 'base64') continue;
    manifests.push({ path, content: Buffer.from(file.content, 'base64').toString('utf8') });
  }
  return manifests;
}

async function collectMergedPrs(login: string, client: GitHubClient, warnings: string[]) {
  try {
    const search = await client.get(
      `/search/issues?q=${encodeURIComponent(`author:${login} type:pr is:merged`)}&per_page=30&sort=updated`,
      gitHubPrSearchSchema,
    );
    if (!search) return { mergedPullRequests: [], mergedPullRequestTotal: 0 };

    return {
      mergedPullRequestTotal: search.total_count,
      mergedPullRequests: search.items.map((item) => ({
        title: item.title,
        url: item.html_url,
        repoFullName: item.repository_url.replace(/^.*\/repos\//, ''),
        // The search API does not return merged_at; created_at bounds it from below.
        mergedAtApprox: item.created_at,
      })),
    };
  } catch (error) {
    warnings.push(`Merged pull request history unavailable: ${describe(error)}`);
    return { mergedPullRequests: [], mergedPullRequestTotal: 0 };
  }
}

function rateLimitMessage(error: GitHubApiError): string {
  const when = error.resetAt ? ` Resets at ${error.resetAt.toISOString()}.` : '';
  return `GitHub rate limit reached, so the scan is partial.${when} Set GITHUB_TOKEN for a much higher limit.`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
