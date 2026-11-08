import { z } from 'zod';

/** Schemas for the endpoints used by repo-health and issue discovery. */

export const repoDetailSchema = z.object({
  full_name: z.string(),
  html_url: z.string(),
  description: z.string().nullable().default(null),
  stargazers_count: z.number(),
  archived: z.boolean(),
  fork: z.boolean(),
  pushed_at: z.string().nullable().default(null),
  created_at: z.string(),
  open_issues_count: z.number(),
  default_branch: z.string().default('main'),
  language: z.string().nullable().default(null),
  topics: z.array(z.string()).default([]),
  license: z.object({ spdx_id: z.string().nullable() }).nullable().default(null),
});

export const pullRequestListSchema = z.array(
  z.object({
    created_at: z.string(),
    updated_at: z.string(),
    merged_at: z.string().nullable().default(null),
  }),
);

export const issueListSchema = z.array(
  z.object({
    created_at: z.string(),
    closed_at: z.string().nullable().default(null),
    comments: z.number(),
    /** Present only when the "issue" is really a pull request. */
    pull_request: z.unknown().optional(),
  }),
);

export const releaseSchema = z.object({
  published_at: z.string().nullable().default(null),
});

export const workflowRunsSchema = z.object({
  workflow_runs: z
    .array(
      z.object({
        conclusion: z.string().nullable().default(null),
        created_at: z.string(),
      }),
    )
    .default([]),
});

/** One request that reports whether CONTRIBUTING and issue templates exist. */
export const communityProfileSchema = z.object({
  files: z.object({
    contributing: z.unknown().nullable().default(null),
    issue_template: z.unknown().nullable().default(null),
  }),
});

export const issueSearchSchema = z.object({
  total_count: z.number(),
  incomplete_results: z.boolean().default(false),
  items: z.array(
    z.object({
      id: z.number(),
      number: z.number(),
      title: z.string(),
      html_url: z.string(),
      repository_url: z.string(),
      labels: z.array(z.object({ name: z.string() })).default([]),
      created_at: z.string(),
      updated_at: z.string(),
      comments: z.number(),
      assignee: z.unknown().nullable().default(null),
      assignees: z.array(z.unknown()).default([]),
      body: z.string().nullable().default(null),
      state: z.string(),
    }),
  ),
});
