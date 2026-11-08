import { beforeEach, describe, expect, it } from 'vitest';
import { createGitHubClient } from '@/lib/github/client';
import { analyzeRepository } from './analyze-repo';

const TREE = [
  'package.json',
  'src/index.ts',
  '.github/workflows/ci.yml',
  'CONTRIBUTING.md',
  'README.md',
];

function stubGitHub(options: { missing?: boolean; rateLimited?: boolean } = {}) {
  const log: string[] = [];

  const impl: typeof fetch = async (input) => {
    const url = String(input);
    log.push(url);
    const json = (body: unknown) => new Response(JSON.stringify(body));

    if (options.rateLimited) {
      return new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
    }
    if (options.missing) return new Response('{}', { status: 404 });

    if (url.includes('/git/trees/')) {
      return json({ truncated: false, tree: TREE.map((path) => ({ path, type: 'blob' })) });
    }
    if (url.includes('/contents/')) {
      const path = decodeURIComponent(url.split('/contents/')[1]);
      const bodies: Record<string, string> = {
        'package.json': JSON.stringify({ engines: { node: '>=20' }, scripts: { test: 'vitest' } }),
        '.github/workflows/ci.yml': 'jobs:\n  b:\n    steps:\n      - run: npm ci',
        'CONTRIBUTING.md': '- Add tests for any behaviour you change.',
      };
      const content = bodies[path];
      if (content === undefined) return new Response('{}', { status: 404 });
      return json({ encoding: 'base64', content: Buffer.from(content).toString('base64') });
    }
    return json({
      full_name: 'acme/widget',
      html_url: 'https://github.com/acme/widget',
      description: 'a widget',
      stargazers_count: 1,
      archived: false,
      fork: false,
      pushed_at: '2025-12-01T00:00:00.000Z',
      created_at: '2024-01-01T00:00:00.000Z',
      open_issues_count: 1,
      default_branch: 'trunk',
      language: 'TypeScript',
      topics: [],
      license: null,
    });
  };

  return { impl, log };
}

/**
 * A fixed toolchain. Without this the service tests would spawn real `node`,
 * `git` and `python` processes, making them slow and dependent on whatever the
 * machine running them happens to have installed.
 */
const FAKE_TOOLS = {
  runProbe: async (probe: { id: string }) =>
    ({ node: '20.11.0', npm: '10.2.0', git: '2.43.0', python: '3.12.0' })[probe.id] ?? null,
};

beforeEach(() => {
  // The analysis cache is process-wide by design; clear it between cases.
  (globalThis as { __firstprRepoAnalyses?: Map<string, unknown> }).__firstprRepoAnalyses?.clear();
});

describe('analyzeRepository', () => {
  it('collects, analyses and reports setup in one call', async () => {
    const { impl } = stubGitHub();
    const result = await analyzeRepository('acme/widget', {
      client: createGitHubClient({ fetchImpl: impl }),
      doctor: FAKE_TOOLS,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.analysis.ecosystems).toEqual(['node']);
    expect(result.analysis.entryPoints.map((ref) => ref.path)).toEqual(['src/index.ts']);
    expect(result.analysis.commands.some((command) => command.fromCi)).toBe(true);
    expect(result.setup.checks.length).toBeGreaterThan(0);
  });

  it('builds source URLs from the repo’s real default branch', async () => {
    const { impl } = stubGitHub();
    const result = await analyzeRepository('acme/widget', {
      client: createGitHubClient({ fetchImpl: impl }),
      doctor: FAKE_TOOLS,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.analysis.entryPoints[0].url).toContain('/blob/trunk/');
  });

  it('only requests files the tree proved exist', async () => {
    const { impl, log } = stubGitHub();
    await analyzeRepository('acme/widget', {
      client: createGitHubClient({ fetchImpl: impl }),
      doctor: FAKE_TOOLS,
    });

    const requested = log.filter((url) => url.includes('/contents/'));
    expect(requested.some((url) => url.endsWith('/contents/package.json'))).toBe(true);
    expect(requested.some((url) => url.includes('go.mod'))).toBe(false);
  });

  it('serves a repeat request from the process cache', async () => {
    const { impl, log } = stubGitHub();
    const client = createGitHubClient({ fetchImpl: impl });
    const deps = { client, doctor: FAKE_TOOLS };

    const first = await analyzeRepository('acme/widget', deps);
    const countAfterFirst = log.length;
    const second = await analyzeRepository('acme/widget', deps);

    expect(first.ok && second.ok).toBe(true);
    expect(log.length).toBe(countAfterFirst);
    expect(second.ok && second.cached).toBe(true);
  });

  it('refetches when a refresh is asked for', async () => {
    const { impl, log } = stubGitHub();
    const client = createGitHubClient({ fetchImpl: impl });
    const deps = { client, doctor: FAKE_TOOLS };

    await analyzeRepository('acme/widget', deps);
    const countAfterFirst = log.length;
    await analyzeRepository('acme/widget', { ...deps, refresh: true });

    expect(log.length).toBeGreaterThan(countAfterFirst);
  });

  it.each(['not-a-repo', 'owner/', '/name', 'a b/c', '../etc/passwd'])(
    'rejects %s without making a request',
    async (name) => {
      const { impl, log } = stubGitHub();
      const result = await analyzeRepository(name, {
        client: createGitHubClient({ fetchImpl: impl }),
        doctor: FAKE_TOOLS,
      });

      expect(result.ok).toBe(false);
      expect(log).toHaveLength(0);
    },
  );

  it('reports a missing repository clearly', async () => {
    const { impl } = stubGitHub({ missing: true });
    const result = await analyzeRepository('acme/ghost', {
      client: createGitHubClient({ fetchImpl: impl }),
      doctor: FAKE_TOOLS,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('was not found');
  });

  it('explains a rate limit and how to lift it', async () => {
    const { impl } = stubGitHub({ rateLimited: true });
    const result = await analyzeRepository('acme/widget', {
      client: createGitHubClient({ fetchImpl: impl }),
      doctor: FAKE_TOOLS,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Sign in with GitHub');
  });

  it('never runs a command the repository named', async () => {
    // The doctor's probe table is fixed; a hostile script name must not reach it.
    const { impl } = stubGitHub();
    const seen: string[] = [];
    const result = await analyzeRepository('acme/widget', {
      client: createGitHubClient({ fetchImpl: impl }),
      doctor: FAKE_TOOLS,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const check of result.setup.checks) seen.push(check.tool);
    expect(
      seen.every((tool) =>
        ['node', 'npm', 'python', 'go', 'docker', 'docker compose', 'git'].includes(tool),
      ),
    ).toBe(true);
  });
});
