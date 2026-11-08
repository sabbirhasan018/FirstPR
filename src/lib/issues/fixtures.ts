import { scoreRepoHealth } from '@/lib/health/engine';
import { healthyRepo, makeHealthSnapshot, neglectedRepo } from '@/lib/health/fixtures';
import type { RepoHealth } from '@/lib/health/types';
import type { EvidenceReport } from '@/lib/evidence/types';
import type { IssueCandidate } from './types';

export const ISSUES_NOW = new Date('2026-01-01T00:00:00.000Z');

const daysAgo = (days: number) =>
  new Date(ISSUES_NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

let nextId = 1;

export function makeIssue(overrides: Partial<IssueCandidate> = {}): IssueCandidate {
  const id = overrides.id ?? nextId++;
  return {
    id,
    number: id,
    title: `Issue ${id}`,
    url: `https://github.com/acme/healthy/issues/${id}`,
    repoFullName: 'acme/healthy',
    labels: [],
    createdAt: daysAgo(30),
    updatedAt: daysAgo(5),
    commentCount: 1,
    hasAssignee: false,
    bodyLength: 900,
    searchedLanguage: 'TypeScript',
    ...overrides,
  };
}

/** A user who has proven TypeScript strongly and Python weakly. */
export function sampleEvidence(): EvidenceReport {
  return {
    login: 'octo',
    generatedAt: ISSUES_NOW.toISOString(),
    unmatchedRepos: [],
    notes: [],
    skills: [
      skill('language:TypeScript', 'TypeScript', 'language', 88),
      skill('language:Python', 'Python', 'language', 30),
      skill('react', 'React', 'framework', 70),
    ],
  };
}

function skill(
  skillId: string,
  label: string,
  category: EvidenceReport['skills'][number]['category'],
  score: number,
): EvidenceReport['skills'][number] {
  return {
    skillId,
    label,
    category,
    confidence: score >= 65 ? 'strong' : score >= 35 ? 'moderate' : 'weak',
    score,
    breadth: 1,
    freshness: 1,
    depth: 1,
    repoCount: 3,
    lastObservedAt: ISSUES_NOW.toISOString(),
    rationale: 'fixture',
    citations: [
      { kind: 'file', repo: 'octo/demo', detail: 'src/index.ts', url: 'https://example.test' },
    ],
  };
}

export function sampleHealth(): Map<string, RepoHealth> {
  return new Map([
    ['acme/healthy', scoreRepoHealth(healthyRepo(), ISSUES_NOW)],
    ['acme/neglected', scoreRepoHealth(neglectedRepo(), ISSUES_NOW)],
    [
      'acme/unknown',
      scoreRepoHealth(makeHealthSnapshot({ fullName: 'acme/unknown' }), ISSUES_NOW),
    ],
  ]);
}

export function sampleRepoContext(): Map<string, { primaryLanguage: string | null; topics: string[] }> {
  return new Map([
    ['acme/healthy', { primaryLanguage: 'TypeScript', topics: ['react'] }],
    ['acme/neglected', { primaryLanguage: 'TypeScript', topics: [] }],
    ['acme/unknown', { primaryLanguage: 'Perl', topics: [] }],
  ]);
}

/**
 * A candidate set built so the naive approach is misled in both directions:
 * some "good first issue" labels sit in an abandoned repo, and some genuinely
 * workable issues carry no label at all.
 *
 * `good` is the ground truth used by the kill-condition test.
 */
export type LabelledCandidate = { issue: IssueCandidate; good: boolean };

export function benchmarkCandidates(): LabelledCandidate[] {
  nextId = 1;
  return [
    // Genuinely good: healthy repo, matching skill, well specified, unlabelled.
    { issue: makeIssue({ repoFullName: 'acme/healthy', bodyLength: 1200 }), good: true },
    { issue: makeIssue({ repoFullName: 'acme/healthy', bodyLength: 950 }), good: true },
    {
      issue: makeIssue({ repoFullName: 'acme/healthy', labels: ['help wanted'], bodyLength: 1000 }),
      good: true,
    },

    // Labelled beginner-friendly but in a repo that will never merge it.
    {
      issue: makeIssue({
        repoFullName: 'acme/neglected',
        labels: ['good first issue'],
        updatedAt: daysAgo(500),
        bodyLength: 900,
      }),
      good: false,
    },
    {
      issue: makeIssue({
        repoFullName: 'acme/neglected',
        labels: ['good first issue'],
        updatedAt: daysAgo(600),
        bodyLength: 700,
      }),
      good: false,
    },

    // Labelled, matching language, but a one-line wish with a crowd on it.
    {
      issue: makeIssue({
        repoFullName: 'acme/healthy',
        labels: ['good first issue'],
        bodyLength: 40,
        commentCount: 25,
      }),
      good: false,
    },

    // Wrong language entirely.
    { issue: makeIssue({ repoFullName: 'acme/unknown', bodyLength: 1000 }), good: false },

    // Stale despite living in a healthy repo.
    {
      issue: makeIssue({
        repoFullName: 'acme/healthy',
        updatedAt: daysAgo(500),
        bodyLength: 800,
      }),
      good: false,
    },
  ];
}
