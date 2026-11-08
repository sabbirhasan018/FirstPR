import { describe, expect, it } from 'vitest';
import type { ChangedFile, PreflightInput } from '@/lib/preflight/types';
import {
  composeAllDrafts,
  composeIssueClaim,
  composeNudge,
  composePrDescription,
  composeReviewResponse,
  type ComposeContext,
} from './compose';

const file = (path: string, added = 10, removed = 2): ChangedFile => ({
  path,
  added,
  removed,
  status: 'modified',
});

const input = (overrides: Partial<PreflightInput> = {}): PreflightInput => ({
  branch: 'fix-parser',
  baseBranch: 'main',
  changedFiles: [file('src/parser.ts'), file('src/parser.test.ts')],
  commitSubjects: ['fix: handle empty config'],
  commitBodies: [],
  behindBy: 0,
  prTitle: null,
  prBody: null,
  linkedIssue: 42,
  contributorRuleIds: [],
  hasTestCommand: true,
  ...overrides,
});

const context = (overrides: Partial<ComposeContext> = {}): ComposeContext => ({
  repoFullName: 'acme/widget',
  issueNumber: 42,
  issueTitle: 'Parser throws on an empty config file',
  contributorRuleIds: [],
  testCommand: 'npm test',
  ...overrides,
});

describe('composePrDescription', () => {
  it('is deterministic', () => {
    expect(composePrDescription(input(), context())).toEqual(
      composePrDescription(input(), context()),
    );
  });

  it('links the issue and lists the changed files', () => {
    const result = composePrDescription(input(), context());

    expect(result.body).toContain('Closes #42.');
    expect(result.body).toContain('src/parser.ts');
    expect(result.body).toContain('2 file(s)');
  });

  it('cites the tests that were added and the command that runs them', () => {
    const result = composePrDescription(input(), context());

    expect(result.body).toContain('Added 1 test');
    expect(result.body).toContain('npm test');
  });

  it('leaves verification as a placeholder when no test was touched', () => {
    const result = composePrDescription(
      input({ changedFiles: [file('src/parser.ts')] }),
      context(),
    );

    expect(result.placeholders).toContain('how you verified this');
  });

  it('asks for an issue number rather than inventing one', () => {
    const result = composePrDescription(input({ linkedIssue: null }), context({ issueNumber: null }));

    expect(result.body).toContain('Closes #<issue number>');
    expect(result.placeholders).toContain('issue number');
  });

  it('never invents the reasoning, only the structure', () => {
    const result = composePrDescription(input(), context());

    // The "what" and per-file "why" must remain the author's words.
    expect(result.placeholders.length).toBeGreaterThan(0);
    expect(result.body).toContain('<one sentence on the behaviour that was wrong');
  });

  it('truncates a very long file list instead of dumping it', () => {
    const many = Array.from({ length: 20 }, (_, i) => file(`src/file${i}.ts`));
    const result = composePrDescription(input({ changedFiles: many }), context());

    expect(result.body).toContain('and 12 more file(s)');
  });
});

describe('composeIssueClaim', () => {
  it('references the issue and asks for confirmation of the approach', () => {
    const result = composeIssueClaim(context());

    expect(result.body).toContain('#42');
    expect(result.body).toContain('Does that match');
    expect(result.placeholders).toContain('the approach you intend to take');
  });

  it('falls back to a generic reference without an issue number', () => {
    expect(composeIssueClaim(context({ issueNumber: null })).body).toContain('this issue');
  });
});

describe('other drafts', () => {
  it('offers to make the reviewer’s job easier when nudging', () => {
    const result = composeNudge(9);

    expect(result.title).toContain('9 days');
    expect(result.body).toContain('rebase or split it up');
  });

  it('leaves room to disagree in a review response', () => {
    expect(composeReviewResponse().body).toContain('disagreed');
  });

  it('every draft explains why it says what it says', () => {
    for (const item of composeAllDrafts(input(), context())) {
      expect(item.rationale.length).toBeGreaterThan(20);
      expect(item.body.length).toBeGreaterThan(20);
    }
  });
});
