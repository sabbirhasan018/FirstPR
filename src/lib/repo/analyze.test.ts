import { describe, expect, it } from 'vitest';
import { analyzeRepo, extractRunCommands } from './analyze';
import { pickWorkflows } from './collect';
import { makeRepoSnapshot, nodeRepoSnapshot, pythonRepoSnapshot } from './fixtures';

const commandsOf = (analysis: ReturnType<typeof analyzeRepo>, kind: string) =>
  analysis.commands.filter((command) => command.kind === kind).map((command) => command.command);

describe('analyzeRepo', () => {
  it('is deterministic', () => {
    expect(analyzeRepo(nodeRepoSnapshot())).toEqual(analyzeRepo(nodeRepoSnapshot()));
  });

  it('detects ecosystems from manifest files', () => {
    expect(analyzeRepo(nodeRepoSnapshot()).ecosystems).toEqual(['node']);
    expect(analyzeRepo(pythonRepoSnapshot()).ecosystems).toEqual(['python']);
    expect(analyzeRepo(makeRepoSnapshot()).ecosystems).toEqual(['unknown']);
  });

  it('ignores dependency and build directories', () => {
    const analysis = analyzeRepo(nodeRepoSnapshot());
    expect(analysis.keyDirectories.map((dir) => dir.path)).not.toContain('node_modules');
    expect(analysis.fileCount).toBe(12); // 13 paths minus the node_modules entry
  });

  it('finds entry points, shallowest first', () => {
    const analysis = analyzeRepo(nodeRepoSnapshot());
    expect(analysis.entryPoints.map((ref) => ref.path)).toEqual(['src/index.ts']);
    expect(analysis.entryPoints[0].url).toBe('https://github.com/acme/web/blob/main/src/index.ts');
  });

  it('classifies key directories by role', () => {
    const roles = new Map(
      analyzeRepo(nodeRepoSnapshot()).keyDirectories.map((dir) => [dir.path, dir.role]),
    );
    expect(roles.get('src')).toBe('source');
    expect(roles.get('tests')).toBe('tests');
    expect(roles.get('docs')).toBe('docs');
    expect(roles.get('migrations')).toBe('migrations');
    expect(roles.get('.github')).toBe('ci');
  });

  it('reads runnable commands from package.json scripts', () => {
    const analysis = analyzeRepo(nodeRepoSnapshot());
    expect(commandsOf(analysis, 'build')).toContain('npm run build');
    expect(commandsOf(analysis, 'lint')).toContain('npm run lint');
    // "release" is a script but not a lifecycle command anyone needs to run.
    expect(analysis.commands.map((c) => c.command)).not.toContain('npm run release');
  });

  it('prefers CI commands, because CI is what a pull request must survive', () => {
    const analysis = analyzeRepo(nodeRepoSnapshot());
    const ciCommands = analysis.commands.filter((command) => command.fromCi);

    expect(ciCommands.map((c) => c.command)).toContain('npm test -- --coverage');
    expect(ciCommands.map((c) => c.command)).toContain('npm ci');
    // CI-sourced commands sort ahead of equivalents from elsewhere.
    expect(analysis.commands[0].fromCi).toBe(true);
  });

  it('skips unexpanded CI template expressions', () => {
    const analysis = analyzeRepo(nodeRepoSnapshot());
    expect(analysis.commands.every((command) => !command.command.includes('${{'))).toBe(true);
  });

  it('reads Makefile targets and ignores variable assignments', () => {
    const analysis = analyzeRepo(pythonRepoSnapshot());
    expect(commandsOf(analysis, 'test')).toContain('make test');
    expect(commandsOf(analysis, 'lint')).toContain('make lint');
    expect(analysis.commands.map((c) => c.command)).not.toContain('make DEBUG');
  });

  it('extracts setup requirements with the version the repo states', () => {
    const node = analyzeRepo(nodeRepoSnapshot()).setupRequirements;
    const nodeReq = node.find((requirement) => requirement.tool === 'node');
    expect(nodeReq?.version).toBeTruthy();
    expect(node.map((r) => r.tool)).toContain('docker');

    const python = analyzeRepo(pythonRepoSnapshot()).setupRequirements;
    expect(python.find((r) => r.tool === 'python')?.version).toBe('>=3.11');
  });

  it('extracts contributor rules with the line they came from', () => {
    const rules = analyzeRepo(nodeRepoSnapshot()).contributorRules;
    const ids = rules.map((rule) => rule.id);

    expect(ids).toContain('dco');
    expect(ids).toContain('issue-first');
    expect(ids).toContain('tests-required');
    expect(ids).toContain('conventional-commits');
    for (const rule of rules) {
      expect(rule.source.path).toBe('CONTRIBUTING.md');
      expect(rule.source.excerpt?.length).toBeGreaterThan(0);
    }
  });

  it('says what it could not find rather than staying silent', () => {
    const notes = analyzeRepo(pythonRepoSnapshot()).notes.join(' ');
    expect(notes).toContain('No CONTRIBUTING guide');
    expect(notes).toContain('No GitHub Actions workflows');
  });

  it('flags a truncated file listing', () => {
    const notes = analyzeRepo(makeRepoSnapshot({ treeTruncated: true })).notes.join(' ');
    expect(notes).toContain('truncated');
  });

  it('reads multi-line CI run blocks, not just single-line steps', () => {
    // Found against pallets/flask, where every real command lives in a block
    // scalar and single-line parsing surfaced only "uv build".
    const analysis = analyzeRepo(
      makeRepoSnapshot({
        filePaths: ['.github/workflows/tests.yaml'],
        files: [
          {
            path: '.github/workflows/tests.yaml',
            content: [
              'jobs:',
              '  tests:',
              '    steps:',
              '      - run: |',
              '          pip install -e .',
              '          pytest --cov',
              '      - run: ruff check .',
              '      - uses: actions/checkout@v4',
            ].join('\n'),
          },
        ],
      }),
    );

    const commands = analysis.commands.map((command) => command.command);
    expect(commands).toContain('pip install -e .');
    expect(commands).toContain('pytest --cov');
    expect(commands).toContain('ruff check .');
    expect(analysis.commands.every((command) => command.fromCi)).toBe(true);
  });

  it('recognises test runners that never say the word "test"', () => {
    // pallets/flask runs its whole suite as `uv run ... tox run`; an earlier
    // classifier looked only for /test/ and discarded both real commands.
    const analysis = analyzeRepo(
      makeRepoSnapshot({
        filePaths: ['.github/workflows/tests.yaml'],
        files: [
          {
            path: '.github/workflows/tests.yaml',
            content: [
              'jobs:',
              '  tests:',
              '    steps:',
              '      - run: uv run --locked --group dev tox run',
              '  typing:',
              '    steps:',
              '      - run: uv run --locked --group dev tox run -e typing',
            ].join('\n'),
          },
        ],
      }),
    );

    const byKind = new Map(analysis.commands.map((command) => [command.command, command.kind]));
    expect(byKind.get('uv run --locked --group dev tox run')).toBe('test');
    // The narrower category wins when a type check runs through a test runner.
    expect(byKind.get('uv run --locked --group dev tox run -e typing')).toBe('typecheck');
  });

  it('ignores shell plumbing that merely mentions a keyword', () => {
    // Found against vitest-dev/vitest, where copying a file whose path contains
    // "test" was being presented as the way to run the test suite.
    const analysis = analyzeRepo(
      makeRepoSnapshot({
        filePaths: ['.github/workflows/ci.yml'],
        files: [
          {
            path: '.github/workflows/ci.yml',
            content: [
              'jobs:',
              '  a:',
              '    steps:',
              '      - run: cp -rf ./test/e2e/index.html ./test/e2e/test-e2e.html',
              '      - run: echo "::notice::test/unit finished"',
              '      - run: git add . && git commit -m ci',
              '      - run: pnpm run test:ci',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(analysis.commands.map((command) => command.command)).toEqual(['pnpm run test:ci']);
  });

  it('caps how many commands it shows per category', () => {
    const runs = Array.from({ length: 12 }, (_, i) => `      - run: pnpm run test:suite${i}`);
    const analysis = analyzeRepo(
      makeRepoSnapshot({
        filePaths: ['.github/workflows/ci.yml'],
        files: [
          {
            path: '.github/workflows/ci.yml',
            content: ['jobs:', '  a:', '    steps:', ...runs].join('\n'),
          },
        ],
      }),
    );

    expect(analysis.commands.filter((command) => command.kind === 'test')).toHaveLength(4);
  });

  it.each([
    [['pnpm-lock.yaml'], 'pnpm install'],
    [['yarn.lock'], 'yarn install'],
    [['package-lock.json'], 'npm ci'],
    [[], 'npm install'],
  ])('derives the install command from the lockfile %s', (lockfiles, expected) => {
    const analysis = analyzeRepo(
      makeRepoSnapshot({ filePaths: ['package.json', ...lockfiles] }),
    );
    expect(analysis.commands.map((command) => command.command)).toContain(expected);
  });

  it('recognises reStructuredText contributor guides', () => {
    const analysis = analyzeRepo(
      makeRepoSnapshot({
        filePaths: ['CONTRIBUTING.rst'],
        files: [
          { path: 'CONTRIBUTING.rst', content: 'Please add tests for any behaviour you change.' },
        ],
      }),
    );

    expect(analysis.contributorRules.map((rule) => rule.id)).toContain('tests-required');
    expect(analysis.notes.join(' ')).not.toContain('No CONTRIBUTING guide');
  });

  it('treats a Python package __init__ as an entry point', () => {
    const analysis = analyzeRepo(
      makeRepoSnapshot({
        filePaths: ['pyproject.toml', 'src/flask/__init__.py', 'src/flask/app.py'],
      }),
    );
    expect(analysis.entryPoints.map((ref) => ref.path)).toContain('src/flask/__init__.py');
  });

  it('survives a malformed package.json without losing the rest', () => {
    const analysis = analyzeRepo(
      makeRepoSnapshot({
        filePaths: ['package.json', 'src/index.ts'],
        files: [{ path: 'package.json', content: '{ broken' }],
      }),
    );

    expect(analysis.ecosystems).toEqual(['node']);
    expect(analysis.entryPoints.map((ref) => ref.path)).toEqual(['src/index.ts']);
    expect(analysis.setupRequirements.map((r) => r.tool)).toContain('node');
  });
});

describe('extractRunCommands', () => {
  it('stops a block at the next less-indented key', () => {
    const yaml = ['      - run: |', '          make test', '      - name: after', '        id: x'].join(
      '\n',
    );
    expect(extractRunCommands(yaml)).toEqual(['make test']);
  });

  it('ignores comments inside a block', () => {
    const yaml = ['      - run: |', '          # set up', '          npm ci'].join('\n');
    expect(extractRunCommands(yaml)).toEqual(['npm ci']);
  });

  it('handles the folded and stripped scalar markers', () => {
    for (const marker of ['|', '>', '|-', '>-']) {
      expect(extractRunCommands(`      - run: ${marker}\n          npm test`)).toEqual(['npm test']);
    }
  });
});

describe('pickWorkflows', () => {
  it('prefers test and CI workflows over release ones', () => {
    const picked = pickWorkflows([
      '.github/workflows/publish.yaml',
      '.github/workflows/tests.yaml',
      '.github/workflows/stale.yaml',
      '.github/workflows/lint.yaml',
      'src/index.ts',
    ]);

    expect(picked).toContain('.github/workflows/tests.yaml');
    expect(picked).toContain('.github/workflows/lint.yaml');
    expect(picked).not.toContain('src/index.ts');
  });
});
