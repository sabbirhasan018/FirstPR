import { describe, expect, it } from 'vitest';
import { runPreflight } from './engine';
import type { ChangedFile, PreflightInput } from './types';

const file = (path: string, added = 10, removed = 2): ChangedFile => ({
  path,
  added,
  removed,
  status: 'modified',
});

function makeInput(overrides: Partial<PreflightInput> = {}): PreflightInput {
  return {
    branch: 'fix-parser',
    baseBranch: 'main',
    changedFiles: [file('src/parser.ts'), file('src/parser.test.ts')],
    commitSubjects: ['fix: handle empty config'],
    commitBodies: ['fix: handle empty config\n\nDetails.'],
    behindBy: 0,
    prTitle: 'Fix parser on empty config',
    prBody:
      'The parser threw on an empty config file. This returns an empty object instead, and adds a regression test covering it.',
    linkedIssue: 42,
    contributorRuleIds: [],
    hasTestCommand: true,
    ...overrides,
  };
}

const check = (report: ReturnType<typeof runPreflight>, id: string) =>
  report.checks.find((entry) => entry.id === id)!;

describe('runPreflight', () => {
  it('passes a well-formed contribution with no blockers', () => {
    const report = runPreflight(makeInput());

    expect(report.blockers).toBe(0);
    expect(report.readyToOpen).toBe(true);
    expect(report.summary).toContain('Nothing outstanding');
  });

  it('is deterministic', () => {
    expect(runPreflight(makeInput())).toEqual(runPreflight(makeInput()));
  });

  it('blocks committing directly to the base branch', () => {
    const report = runPreflight(makeInput({ branch: 'main' }));

    expect(check(report, 'branch').outcome).toBe('fail');
    expect(check(report, 'branch').severity).toBe('blocker');
    expect(report.readyToOpen).toBe(false);
  });

  it('blocks an empty branch', () => {
    const report = runPreflight(makeInput({ changedFiles: [] }));
    expect(check(report, 'has-changes').outcome).toBe('fail');
  });

  it('blocks a missing description but only warns on a thin one', () => {
    expect(check(runPreflight(makeInput({ prBody: '' })), 'description').severity).toBe('blocker');

    const thin = runPreflight(makeInput({ prBody: 'fixes it' }));
    expect(check(thin, 'description').outcome).toBe('fail');
    expect(check(thin, 'description').severity).toBe('warning');
  });

  describe('secret detection', () => {
    it('blocks a credential-shaped filename', () => {
      const report = runPreflight(makeInput({ changedFiles: [file('.env.production')] }));
      const secrets = check(report, 'secrets');

      expect(secrets.outcome).toBe('fail');
      expect(secrets.severity).toBe('blocker');
      expect(secrets.fix).toContain('rotate');
    });

    it.each([
      'ghp_abcdefghijklmnopqrstuvwxyz0123',
      'github_pat_11ABCDEFGHIJKLMNOPQRSTU',
      '-----BEGIN RSA PRIVATE KEY-----',
      'AKIAIOSFODNN7EXAMPLE',
    ])('blocks %s appearing in the diff', (secret) => {
      const report = runPreflight(makeInput(), { diffText: `+const token = "${secret}";` });
      expect(check(report, 'secrets').outcome).toBe('fail');
    });

    it('says the diff was not scanned when no diff text is supplied', () => {
      const report = runPreflight(makeInput());
      expect(check(report, 'secrets').detail).toContain('not available to scan');
    });

    it('does not fire on ordinary code', () => {
      const report = runPreflight(makeInput(), {
        diffText: '+const apiKey = process.env.API_KEY; // sk-placeholder',
      });
      expect(check(report, 'secrets').outcome).toBe('pass');
    });
  });

  describe('diff size', () => {
    it('warns past the review threshold', () => {
      const report = runPreflight(makeInput({ changedFiles: [file('src/a.ts', 400, 100)] }));
      const size = check(report, 'diff-size');

      expect(size.outcome).toBe('fail');
      expect(size.severity).toBe('warning');
    });

    it('blocks a diff nobody will review', () => {
      const report = runPreflight(makeInput({ changedFiles: [file('src/a.ts', 1500, 0)] }));
      expect(check(report, 'diff-size').severity).toBe('blocker');
    });

    it('excludes lockfiles from the reviewable count', () => {
      const report = runPreflight(
        makeInput({
          changedFiles: [file('package.json', 3, 1), file('package-lock.json', 5000, 4000)],
        }),
      );
      expect(check(report, 'diff-size').outcome).toBe('pass');
    });
  });

  describe('tests', () => {
    it('warns when source changed without any test', () => {
      const report = runPreflight(makeInput({ changedFiles: [file('src/parser.ts')] }));
      expect(check(report, 'tests').outcome).toBe('fail');
    });

    it('skips for a documentation-only change', () => {
      const report = runPreflight(makeInput({ changedFiles: [file('README.md')] }));
      expect(check(report, 'tests').outcome).toBe('skipped');
    });

    it('skips when the repository has no test command', () => {
      const report = runPreflight(
        makeInput({ changedFiles: [file('src/a.ts')], hasTestCommand: false }),
      );
      expect(check(report, 'tests').outcome).toBe('skipped');
    });
  });

  describe('repository rules', () => {
    it('blocks missing sign-off only when the repo requires a DCO', () => {
      expect(check(runPreflight(makeInput()), 'sign-off').outcome).toBe('skipped');

      const withDco = runPreflight(makeInput({ contributorRuleIds: ['dco'] }));
      expect(check(withDco, 'sign-off').outcome).toBe('fail');
      expect(check(withDco, 'sign-off').fix).toContain('--signoff');
    });

    it('passes sign-off when every commit carries one', () => {
      const report = runPreflight(
        makeInput({
          contributorRuleIds: ['dco'],
          commitBodies: ['fix: thing\n\nSigned-off-by: A Dev <a@example.com>'],
        }),
      );
      expect(check(report, 'sign-off').outcome).toBe('pass');
    });

    it('enforces conventional commits only when the repo asks for them', () => {
      const input = makeInput({ commitSubjects: ['made it work'] });
      expect(check(runPreflight(input), 'commit-messages').outcome).toBe('pass');

      const strict = runPreflight({ ...input, contributorRuleIds: ['conventional-commits'] });
      expect(check(strict, 'commit-messages').outcome).toBe('fail');
      expect(check(strict, 'commit-messages').detail).toContain('Conventional Commits');
    });
  });

  it('flags placeholder commit messages', () => {
    const report = runPreflight(makeInput({ commitSubjects: ['wip', 'fix: real one'] }));
    expect(check(report, 'commit-messages').outcome).toBe('fail');
    expect(check(report, 'commit-messages').detail).toContain('wip');
  });

  it('warns about a badly stale branch but tolerates a slightly old one', () => {
    expect(check(runPreflight(makeInput({ behindBy: 5 })), 'stale').outcome).toBe('pass');
    expect(check(runPreflight(makeInput({ behindBy: 90 })), 'stale').outcome).toBe('fail');
  });

  it('flags generated files in the diff', () => {
    const report = runPreflight(
      makeInput({ changedFiles: [file('dist/bundle.js'), file('src/a.ts')] }),
    );
    expect(check(report, 'generated').outcome).toBe('fail');
  });

  it('flags a lockfile that changed without its manifest', () => {
    const report = runPreflight(makeInput({ changedFiles: [file('package-lock.json', 20, 20)] }));
    expect(check(report, 'lockfile').outcome).toBe('fail');
  });

  it('accepts a lockfile changed alongside its manifest', () => {
    const report = runPreflight(
      makeInput({ changedFiles: [file('package.json'), file('package-lock.json')] }),
    );
    expect(check(report, 'lockfile').outcome).toBe('pass');
  });

  it('accepts an issue linked through the description instead of the field', () => {
    const report = runPreflight(
      makeInput({ linkedIssue: null, prBody: 'Closes #12. '.padEnd(120, 'x') }),
    );
    expect(check(report, 'issue-link').outcome).toBe('pass');
  });

  it('gives every failing check something actionable to do', () => {
    const report = runPreflight(
      makeInput({
        branch: 'main',
        changedFiles: [file('dist/x.js', 900, 900)],
        commitSubjects: ['wip'],
        prBody: '',
        linkedIssue: null,
        behindBy: 99,
      }),
    );

    const failures = report.checks.filter((entry) => entry.outcome === 'fail');
    expect(failures.length).toBeGreaterThan(4);
    for (const failure of failures) {
      expect(failure.fix?.length ?? 0).toBeGreaterThan(0);
    }
    expect(report.readyToOpen).toBe(false);
  });
});
