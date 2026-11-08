import { z } from 'zod';

/**
 * Zod schemas for the subset of the GitHub REST API this app depends on.
 * Everything crossing the network boundary is parsed before use.
 */

export const gitHubUserSchema = z.object({
  login: z.string(),
  name: z.string().nullable().default(null),
  avatar_url: z.string(),
  html_url: z.string(),
  bio: z.string().nullable().default(null),
  public_repos: z.number(),
  followers: z.number(),
  created_at: z.string(),
});

export const gitHubRepoSchema = z.object({
  full_name: z.string(),
  name: z.string(),
  html_url: z.string(),
  description: z.string().nullable().default(null),
  fork: z.boolean(),
  archived: z.boolean(),
  stargazers_count: z.number(),
  pushed_at: z.string().nullable().default(null),
  created_at: z.string(),
  default_branch: z.string(),
  language: z.string().nullable().default(null),
  topics: z.array(z.string()).default([]),
});

export const gitHubLanguagesSchema = z.record(z.string(), z.number());

export const gitHubTreeSchema = z.object({
  truncated: z.boolean().default(false),
  tree: z.array(
    z.object({
      path: z.string(),
      type: z.string(),
    }),
  ),
});

export const gitHubContentSchema = z.object({
  encoding: z.string(),
  content: z.string(),
});

export const gitHubPrSearchSchema = z.object({
  total_count: z.number(),
  items: z.array(
    z.object({
      title: z.string(),
      html_url: z.string(),
      created_at: z.string(),
      repository_url: z.string(),
    }),
  ),
});

export type GitHubUser = z.infer<typeof gitHubUserSchema>;
export type GitHubRepo = z.infer<typeof gitHubRepoSchema>;

/** A merged pull request the user authored, normalised for evidence use. */
export type MergedPullRequest = {
  title: string;
  url: string;
  repoFullName: string;
  mergedAtApprox: string;
};

/** A manifest file read from a repository (package.json, requirements.txt, ...). */
export type Manifest = {
  path: string;
  content: string;
};

/**
 * The deterministic input to the evidence engine. Everything here is a fact
 * observed from the GitHub API — no inference has happened yet.
 */
export type RepoSnapshot = {
  fullName: string;
  htmlUrl: string;
  description: string | null;
  isFork: boolean;
  isArchived: boolean;
  stars: number;
  pushedAt: string;
  createdAt: string;
  topics: string[];
  primaryLanguage: string | null;
  languageBytes: Record<string, number>;
  filePaths: string[];
  treeTruncated: boolean;
  manifests: Manifest[];
};

export type ProfileSnapshot = {
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
  bio: string | null;
  publicRepos: number;
  followers: number;
  accountCreatedAt: string;
  collectedAt: string;
  repos: RepoSnapshot[];
  mergedPullRequests: MergedPullRequest[];
  mergedPullRequestTotal: number;
  /** Non-fatal problems during collection (rate limits, private repos, ...). */
  warnings: string[];
};
