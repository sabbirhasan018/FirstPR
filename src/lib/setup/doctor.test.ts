import { describe, expect, it } from 'vitest';
import { analyzeRepo } from '@/lib/repo/analyze';
import { nodeRepoSnapshot, pythonRepoSnapshot } from '@/lib/repo/fixtures';
import { runSetupDoctor, satisfies } from './doctor';

/** Fake toolchain, so results never depend on what this machine has installed. */
const installed = (versions: Record<string, string | null>) => async (probe: { id: string }) =>
  versions[probe.id] ?? null;

const nodeAnalysis = () => analyzeRepo(nodeRepoSnapshot());
const pythonAnalysis = () => analyzeRepo(pythonRepoSnapshot());

describe('satisfies', () => {
  it.each([
    ['20.11.0', '>=20', true],
    ['18.0.0', '>=20', false],
    ['20.11.0', '20.11.0', true],
    ['20.12.0', '^20.1.0', true],
    ['21.0.0', '^20.1.0', false],
    ['3.11.4', '>=3.11', true],
    ['3.10.0', '>=3.11', false],
    ['20.1.5', '~20.1.0', true],
    ['20.2.0', '~20.1.0', false],
  ])('%s against %s is %s', (version, constraint, expected) => {
    expect(satisfies(version, constraint)).toBe(expected);
  });

  it('returns null for ranges it cannot interpret, rather than guessing', () => {
    expect(satisfies('20.0.0', '>=18 <21')).toBeNull();
    expect(satisfies('20.0.0', 'lts/*')).toBeNull();
  });

  it.each([
    ['24.15.0', '^22.12.0 || ^24.0.0 || >=26.0.0', true],
    ['22.14.0', '^22.12.0 || ^24.0.0 || >=26.0.0', true],
    ['26.1.0', '^22.12.0 || ^24.0.0 || >=26.0.0', true],
    ['20.0.0', '^22.12.0 || ^24.0.0 || >=26.0.0', false],
  ])('satisfies %s against the alternation %s', (version, constraint, expected) => {
    // vitest-dev/vitest pins exactly this shape; it previously read as unchecked.
    expect(satisfies(version, constraint)).toBe(expected);
  });

  it('stays unknown when an alternation contains a clause it cannot read', () => {
    expect(satisfies('20.0.0', 'lts/* || ^24.0.0')).toBeNull();
  });
});

describe('runSetupDoctor', () => {
  it('passes when every required tool is present and new enough', async () => {
    const report = await runSetupDoctor(nodeAnalysis(), {
      runProbe: installed({ node: '20.11.0', npm: '10.2.0', docker: '25.0.0', git: '2.43.0' }),
    });

    expect(report.ready).toBe(true);
    expect(report.checks.every((check) => check.status === 'ok')).toBe(true);
  });

  it('reports a missing tool with a concrete fix', async () => {
    const report = await runSetupDoctor(nodeAnalysis(), {
      runProbe: installed({ node: null, npm: null, docker: null, git: '2.43.0' }),
    });

    const node = report.checks.find((check) => check.tool === 'node');
    expect(node?.status).toBe('missing');
    expect(node?.fix).toContain('nodejs.org');
    expect(report.ready).toBe(false);
  });

  it('reports a version mismatch with both numbers', async () => {
    const report = await runSetupDoctor(nodeAnalysis(), {
      runProbe: installed({ node: '18.0.0', npm: '9.0.0', docker: '25.0.0', git: '2.43.0' }),
    });

    const node = report.checks.find((check) => check.tool === 'node');
    expect(node?.status).toBe('wrong-version');
    expect(node?.installed).toBe('18.0.0');
    expect(node?.message).toContain('18.0.0');
    expect(node?.message).toContain(node!.required!);
  });

  it('checks only tools the repository actually implies', async () => {
    const report = await runSetupDoctor(pythonAnalysis(), {
      runProbe: installed({ python: '3.12.0', git: '2.43.0' }),
    });

    const tools = report.checks.map((check) => check.tool);
    expect(tools).toContain('python');
    expect(tools).not.toContain('go');
    expect(tools).not.toContain('docker');
  });

  it('always checks git, whatever the repository says', async () => {
    const report = await runSetupDoctor(pythonAnalysis(), {
      runProbe: installed({ python: '3.12.0', git: '2.43.0' }),
    });
    expect(report.checks.map((check) => check.tool)).toContain('git');
  });

  it('passes an unpinned tool but says the version was not checked', async () => {
    const report = await runSetupDoctor(nodeAnalysis(), {
      runProbe: installed({ node: '20.0.0', npm: '10.0.0', docker: '25.0.0', git: '2.43.0' }),
    });

    const docker = report.checks.find((check) => check.tool === 'docker');
    expect(docker?.status).toBe('ok');
    expect(docker?.message).toContain('does not pin a version');
  });
});
