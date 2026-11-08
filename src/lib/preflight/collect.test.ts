import { describe, expect, it } from 'vitest';
import { collectPreflight, parseNumstat, PreflightError } from './collect';

describe('parseNumstat', () => {
  it('reads added and removed counts per file', () => {
    const files = parseNumstat('12\t3\tsrc/a.ts\n0\t7\tsrc/b.ts\n');

    expect(files).toEqual([
      { path: 'src/a.ts', added: 12, removed: 3, status: 'modified' },
      { path: 'src/b.ts', added: 0, removed: 7, status: 'modified' },
    ]);
  });

  it('treats binary files, which report dashes, as zero lines', () => {
    const files = parseNumstat('-\t-\tassets/logo.png\n');
    expect(files[0]).toMatchObject({ path: 'assets/logo.png', added: 0, removed: 0 });
  });

  it('ignores blank and malformed lines', () => {
    expect(parseNumstat('\n\nnonsense\n5\t5\tok.ts\n')).toHaveLength(1);
  });
});

describe('collectPreflight', () => {
  it('rejects an empty path before touching the filesystem', async () => {
    await expect(collectPreflight({ repoPath: '   ' })).rejects.toBeInstanceOf(PreflightError);
  });

  it.each(['--upload-pack=evil', 'a b', 'branch;rm -rf', '-x', '../../etc'])(
    'rejects %s as a base branch name',
    async (baseBranch) => {
      await expect(collectPreflight({ repoPath: process.cwd(), baseBranch })).rejects.toBeInstanceOf(
        PreflightError,
      );
    },
  );

  it('reports a directory that is not a git repository', async () => {
    await expect(
      collectPreflight({ repoPath: 'no-such-directory-anywhere', baseBranch: 'main' }),
    ).rejects.toBeInstanceOf(PreflightError);
  });

  it('reads this repository as a real end-to-end check', async () => {
    const { input } = await collectPreflight({ repoPath: process.cwd(), baseBranch: 'HEAD' });

    expect(input.branch.length).toBeGreaterThan(0);
    expect(Array.isArray(input.changedFiles)).toBe(true);
    expect(Number.isFinite(input.behindBy)).toBe(true);
  });
});
