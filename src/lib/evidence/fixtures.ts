import type { ProfileSnapshot, RepoSnapshot } from '@/lib/github/types';

/** Fixed clock so evidence tests never drift with the calendar. */
export const FIXTURE_NOW = new Date('2026-01-01T00:00:00.000Z');

export function makeRepo(overrides: Partial<RepoSnapshot> = {}): RepoSnapshot {
  const fullName = overrides.fullName ?? 'octo/demo';
  return {
    fullName,
    htmlUrl: `https://github.com/${fullName}`,
    description: null,
    isFork: false,
    isArchived: false,
    stars: 0,
    pushedAt: '2025-12-01T00:00:00.000Z',
    createdAt: '2024-01-01T00:00:00.000Z',
    topics: [],
    primaryLanguage: null,
    languageBytes: {},
    filePaths: [],
    treeTruncated: false,
    manifests: [],
    ...overrides,
  };
}

export function makeSnapshot(overrides: Partial<ProfileSnapshot> = {}): ProfileSnapshot {
  return {
    login: 'octo',
    name: 'Octo Cat',
    avatarUrl: 'https://avatars.githubusercontent.com/u/1',
    htmlUrl: 'https://github.com/octo',
    bio: null,
    publicRepos: 0,
    followers: 0,
    accountCreatedAt: '2020-01-01T00:00:00.000Z',
    collectedAt: FIXTURE_NOW.toISOString(),
    repos: [],
    mergedPullRequests: [],
    mergedPullRequestTotal: 0,
    warnings: [],
    ...overrides,
  };
}

/** A realistic multi-repo profile used by several tests. */
export function sampleSnapshot(): ProfileSnapshot {
  return makeSnapshot({
    publicRepos: 3,
    repos: [
      makeRepo({
        fullName: 'octo/web-app',
        pushedAt: '2025-12-20T00:00:00.000Z',
        languageBytes: { TypeScript: 180_000, CSS: 4_000 },
        topics: ['nextjs'],
        filePaths: [
          'next.config.ts',
          'src/app/page.tsx',
          'src/lib/api/users.ts',
          'src/lib/api/users.test.ts',
          '.github/workflows/ci.yml',
          'eslint.config.mjs',
        ],
        manifests: [
          {
            path: 'package.json',
            content: JSON.stringify({
              dependencies: { next: '15.0.0', react: '19.0.0' },
              devDependencies: { vitest: '2.0.0', tailwindcss: '4.0.0' },
            }),
          },
        ],
      }),
      makeRepo({
        fullName: 'octo/api-service',
        pushedAt: '2025-10-01T00:00:00.000Z',
        languageBytes: { TypeScript: 90_000 },
        filePaths: [
          'src/routes/health.ts',
          'src/routes/health.test.ts',
          'migrations/0001_init.sql',
          'Dockerfile',
          '.github/workflows/test.yml',
        ],
        manifests: [
          {
            path: 'package.json',
            content: JSON.stringify({ dependencies: { express: '4.19.0' } }),
          },
        ],
      }),
      makeRepo({
        fullName: 'octo/old-fork',
        isFork: true,
        pushedAt: '2021-01-01T00:00:00.000Z',
        languageBytes: { Python: 50_000 },
        filePaths: ['manage.py'],
      }),
    ],
    mergedPullRequests: [
      {
        title: 'Fix null deref in parser',
        url: 'https://github.com/upstream/lib/pull/42',
        repoFullName: 'upstream/lib',
        mergedAtApprox: '2025-11-01T00:00:00.000Z',
      },
    ],
    mergedPullRequestTotal: 1,
  });
}
