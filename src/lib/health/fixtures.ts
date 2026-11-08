import type { RepoHealthSnapshot } from './types';

export const HEALTH_NOW = new Date('2026-01-01T00:00:00.000Z');

const daysAgo = (days: number) =>
  new Date(HEALTH_NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

export function makeHealthSnapshot(
  overrides: Partial<RepoHealthSnapshot> = {},
): RepoHealthSnapshot {
  const fullName = overrides.fullName ?? 'acme/widget';
  return {
    fullName,
    htmlUrl: `https://github.com/${fullName}`,
    description: null,
    stars: 100,
    isArchived: false,
    isFork: false,
    pushedAt: daysAgo(3),
    createdAt: daysAgo(900),
    openIssueCount: 12,
    primaryLanguage: 'TypeScript',
    topics: [],
    license: 'MIT',
    closedPullRequests: [],
    openPullRequests: [],
    recentIssues: [],
    latestReleaseAt: null,
    workflowRuns: [],
    hasContributingDoc: false,
    hasIssueTemplates: false,
    unavailable: [],
    ...overrides,
  };
}

/** A repo showing every sign of a well-run project. */
export function healthyRepo(): RepoHealthSnapshot {
  return makeHealthSnapshot({
    fullName: 'acme/healthy',
    pushedAt: daysAgo(1),
    closedPullRequests: Array.from({ length: 12 }, (_, i) => ({
      createdAt: daysAgo(30 + i),
      updatedAt: daysAgo(5 + i),
      mergedAt: i < 11 ? daysAgo(5 + i) : null,
    })),
    openPullRequests: [
      { createdAt: daysAgo(10), updatedAt: daysAgo(2), mergedAt: null },
      { createdAt: daysAgo(20), updatedAt: daysAgo(4), mergedAt: null },
    ],
    recentIssues: Array.from({ length: 10 }, (_, i) => ({
      createdAt: daysAgo(20 + i),
      closedAt: daysAgo(10 + i),
      commentCount: i < 9 ? 3 : 0,
    })),
    latestReleaseAt: daysAgo(20),
    workflowRuns: Array.from({ length: 10 }, (_, i) => ({
      conclusion: i < 9 ? 'success' : 'failure',
      createdAt: daysAgo(i),
    })),
    hasContributingDoc: true,
    hasIssueTemplates: true,
  });
}

/** A repo that looks abandoned: old push, unmerged PRs, silent issues. */
export function neglectedRepo(): RepoHealthSnapshot {
  return makeHealthSnapshot({
    fullName: 'acme/neglected',
    pushedAt: daysAgo(700),
    closedPullRequests: Array.from({ length: 10 }, (_, i) => ({
      createdAt: daysAgo(500 + i),
      updatedAt: daysAgo(400 + i),
      mergedAt: null,
    })),
    openPullRequests: Array.from({ length: 8 }, (_, i) => ({
      createdAt: daysAgo(600 + i),
      updatedAt: daysAgo(500 + i),
      mergedAt: null,
    })),
    recentIssues: Array.from({ length: 10 }, (_, i) => ({
      createdAt: daysAgo(300 + i),
      closedAt: null,
      commentCount: 0,
    })),
    latestReleaseAt: daysAgo(1200),
    workflowRuns: Array.from({ length: 6 }, (_, i) => ({
      conclusion: i < 1 ? 'success' : 'failure',
      createdAt: daysAgo(700 + i),
    })),
    hasContributingDoc: false,
    hasIssueTemplates: false,
  });
}
