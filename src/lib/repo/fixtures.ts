import type { RepoAnalysisSnapshot } from './types';

export function makeRepoSnapshot(
  overrides: Partial<RepoAnalysisSnapshot> = {},
): RepoAnalysisSnapshot {
  const fullName = overrides.fullName ?? 'acme/widget';
  return {
    fullName,
    htmlUrl: `https://github.com/${fullName}`,
    defaultBranch: 'main',
    description: null,
    primaryLanguage: null,
    filePaths: [],
    treeTruncated: false,
    sourcePaths: [],
    files: [],
    ...overrides,
  };
}

/** A conventional Node/TypeScript project with CI and contributor docs. */
export function nodeRepoSnapshot(): RepoAnalysisSnapshot {
  return makeRepoSnapshot({
    fullName: 'acme/web',
    primaryLanguage: 'TypeScript',
    filePaths: [
      'package.json',
      'package-lock.json',
      '.nvmrc',
      'src/index.ts',
      'src/lib/api.ts',
      'src/lib/api.test.ts',
      'tests/e2e/login.spec.ts',
      'docs/architecture.md',
      'migrations/0001_init.sql',
      '.github/workflows/ci.yml',
      'CONTRIBUTING.md',
      'Dockerfile',
      'node_modules/left-pad/index.js',
    ],
    files: [
      {
        path: 'package.json',
        content: JSON.stringify({
          engines: { node: '>=20' },
          scripts: {
            build: 'tsc -p .',
            test: 'vitest run',
            lint: 'eslint .',
            dev: 'next dev',
            release: 'changeset publish',
          },
        }),
      },
      { path: '.nvmrc', content: '20.11.0\n' },
      {
        path: '.github/workflows/ci.yml',
        content: [
          'jobs:',
          '  build:',
          '    steps:',
          '      - run: npm ci',
          '      - run: npm run lint',
          '      - run: npm test -- --coverage',
          '      - run: ${{ matrix.cmd }}',
        ].join('\n'),
      },
      {
        path: 'CONTRIBUTING.md',
        content: [
          '# Contributing',
          '',
          '- Please open an issue first before starting large changes.',
          '- All commits must include a Signed-off-by line (DCO).',
          '- Add tests for any behaviour you change.',
          '- We use Conventional Commits for commit messages.',
        ].join('\n'),
      },
    ],
  });
}

/** A Python project with no CI and no contributor guide. */
export function pythonRepoSnapshot(): RepoAnalysisSnapshot {
  return makeRepoSnapshot({
    fullName: 'acme/pytool',
    primaryLanguage: 'Python',
    filePaths: [
      'pyproject.toml',
      'requirements.txt',
      'manage.py',
      'src/main.py',
      'tests/test_main.py',
      'Makefile',
    ],
    files: [
      {
        path: 'pyproject.toml',
        content: '[project]\nname = "pytool"\nrequires-python = ">=3.11"\n',
      },
      { path: 'requirements.txt', content: 'django>=4.2\npytest\n' },
      {
        path: 'Makefile',
        content: 'test:\n\tpytest -q\n\nlint:\n\truff check .\n\nDEBUG:=1\n',
      },
    ],
  });
}
