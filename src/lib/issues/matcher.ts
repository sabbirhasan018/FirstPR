import { DETECTION_RULES } from '@/lib/evidence/rules';
import type { EvidenceReport } from '@/lib/evidence/types';
import type { RepoHealth } from '@/lib/health/types';
import type {
  ExcludedIssue,
  IssueCandidate,
  IssueRanking,
  MatchReason,
  RankedIssue,
} from './types';

/**
 * Ranks open issues against a user's evidenced skills and the health of the
 * repository they live in.
 *
 * The score exists to order a list, not to predict an outcome. Every component
 * is reported as a reason the user can read and disagree with, because a
 * recommendation nobody can audit is worth less than no recommendation.
 */

const WEIGHTS = {
  skillMatch: 0.4,
  repoHealth: 0.3,
  approachability: 0.2,
  specification: 0.1,
} as const;

/** Labels maintainers use to mean "this one is suitable for a newcomer". */
const BEGINNER_LABELS = [
  'good first issue',
  'good-first-issue',
  'beginner friendly',
  'beginner-friendly',
  'easy',
  'starter',
  'first-timers-only',
];

const HELP_WANTED_LABELS = ['help wanted', 'help-wanted'];

/** Labels that mean the issue is not actually ready to be worked on. */
const BLOCKED_LABELS = [
  'blocked',
  'on hold',
  'needs design',
  'needs discussion',
  'duplicate',
  'wontfix',
  "won't fix",
  'invalid',
  'question',
];

/** A body shorter than this is usually a one-line wish, not a specification. */
const THIN_BODY_CHARS = 200;
/** Past this, a body is detailed enough that the work is probably scoped. */
const RICH_BODY_CHARS = 800;
/** More comments than this and the issue is likely already being handled. */
const CROWDED_COMMENTS = 10;
/** Issues untouched for longer than this are often quietly dead. */
const STALE_DAYS = 365;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export type RankIssuesInput = {
  candidates: IssueCandidate[];
  evidence: EvidenceReport;
  health: Map<string, RepoHealth>;
  /** Language and topics per repo, used for skill matching. */
  repoContext: Map<string, { primaryLanguage: string | null; topics: string[] }>;
  now?: Date;
};

export function rankIssues(input: RankIssuesInput): IssueRanking {
  const now = input.now ?? new Date();
  const skillScores = new Map(input.evidence.skills.map((s) => [s.skillId, s.score]));

  const ranked: RankedIssue[] = [];
  const excluded: ExcludedIssue[] = [];

  for (const issue of input.candidates) {
    const blocker = hardBlocker(issue, input.health.get(issue.repoFullName));
    if (blocker) {
      excluded.push({ issue, reason: blocker });
      continue;
    }

    // A repo the budget could not scan still matched the language search that
    // found this issue, so fall back to that rather than scoring skill match at
    // zero for something we already know lines up.
    const context = input.repoContext.get(issue.repoFullName) ?? {
      primaryLanguage: issue.searchedLanguage,
      topics: [],
    };
    const matched = matchSkills(context, skillScores);
    const health = input.health.get(issue.repoFullName);

    const parts = {
      skillMatch: skillComponent(matched),
      repoHealth: healthComponent(health),
      approachability: approachabilityComponent(issue, now),
      specification: specificationComponent(issue),
    };

    const score = Math.round(
      100 *
        (WEIGHTS.skillMatch * parts.skillMatch +
          WEIGHTS.repoHealth * parts.repoHealth +
          WEIGHTS.approachability * parts.approachability +
          WEIGHTS.specification * parts.specification),
    );

    ranked.push({
      issue,
      score,
      matchedSkills: matched.map((m) => m.label),
      reasons: buildReasons(issue, matched, health, now),
    });
  }

  ranked.sort(
    (a, b) => b.score - a.score || a.issue.repoFullName.localeCompare(b.issue.repoFullName),
  );

  return { ranked, excluded, notes: buildNotes(input, excluded) };
}

// --- hard filters ----------------------------------------------------------

function hardBlocker(issue: IssueCandidate, health: RepoHealth | undefined): string | null {
  if (issue.hasAssignee) return 'Already assigned to someone.';
  if (health?.archived) return 'The repository is archived and accepts no contributions.';

  const blocked = issue.labels.find((label) => BLOCKED_LABELS.includes(label.toLowerCase()));
  if (blocked) return `Labelled "${blocked}" — not ready to be worked on.`;

  return null;
}

// --- score components ------------------------------------------------------

type MatchedSkill = { skillId: string; label: string; score: number };

function matchSkills(
  context: { primaryLanguage: string | null; topics: string[] },
  skillScores: Map<string, number>,
): MatchedSkill[] {
  const matched: MatchedSkill[] = [];

  if (context.primaryLanguage) {
    const skillId = `language:${context.primaryLanguage}`;
    const score = skillScores.get(skillId);
    if (score !== undefined) {
      matched.push({ skillId, label: context.primaryLanguage, score });
    }
  }

  for (const rule of DETECTION_RULES) {
    const score = skillScores.get(rule.id);
    if (score === undefined) continue;
    if (rule.topics?.some((topic) => context.topics.includes(topic))) {
      matched.push({ skillId: rule.id, label: rule.label, score });
    }
  }

  return matched;
}

/** Driven by the user's strongest matching skill, not by how many matched. */
function skillComponent(matched: MatchedSkill[]): number {
  if (matched.length === 0) return 0;
  return Math.max(...matched.map((m) => m.score)) / 100;
}

/** An unscored repo sits at the midpoint: unknown is not the same as bad. */
function healthComponent(health: RepoHealth | undefined): number {
  if (!health || health.survivalScore === null) return 0.5;
  return health.survivalScore / 100;
}

function approachabilityComponent(issue: IssueCandidate, now: Date): number {
  const labels = issue.labels.map((label) => label.toLowerCase());
  let value = 0.3;

  if (labels.some((label) => BEGINNER_LABELS.includes(label))) value += 0.45;
  else if (labels.some((label) => HELP_WANTED_LABELS.includes(label))) value += 0.25;

  if (issue.commentCount > CROWDED_COMMENTS) value -= 0.2;
  if (daysSince(issue.updatedAt, now) > STALE_DAYS) value -= 0.25;

  return clamp01(value);
}

function specificationComponent(issue: IssueCandidate): number {
  if (issue.bodyLength >= RICH_BODY_CHARS) return 1;
  if (issue.bodyLength <= THIN_BODY_CHARS) return issue.bodyLength / (THIN_BODY_CHARS * 2);
  return (
    0.5 + (0.5 * (issue.bodyLength - THIN_BODY_CHARS)) / (RICH_BODY_CHARS - THIN_BODY_CHARS)
  );
}

// --- explanations ----------------------------------------------------------

function buildReasons(
  issue: IssueCandidate,
  matched: MatchedSkill[],
  health: RepoHealth | undefined,
  now: Date,
): MatchReason[] {
  const reasons: MatchReason[] = [];
  const labels = issue.labels.map((label) => label.toLowerCase());

  if (matched.length > 0) {
    const best = matched.reduce((a, b) => (a.score >= b.score ? a : b));
    reasons.push({
      label: 'Skill match',
      effect: 'boost',
      detail: `You have evidenced ${best.label} at ${best.score}/100, and this repo is built in it.`,
    });
  } else {
    reasons.push({
      label: 'Skill match',
      effect: 'penalty',
      detail: 'None of your evidenced skills line up with this repository.',
    });
  }

  if (!health || health.survivalScore === null) {
    reasons.push({
      label: 'Repo health',
      effect: 'neutral',
      detail: 'Not enough was readable to judge this repository. Check it yourself.',
    });
  } else {
    reasons.push({
      label: 'Repo health',
      effect: health.band === 'healthy' ? 'boost' : health.band === 'mixed' ? 'neutral' : 'penalty',
      detail: `Survival score ${health.survivalScore}/100 — ${health.summary}`,
    });
  }

  if (labels.some((label) => BEGINNER_LABELS.includes(label))) {
    reasons.push({
      label: 'Approachability',
      effect: 'boost',
      detail: 'Maintainers labelled this as suitable for a first-time contributor.',
    });
  } else if (labels.some((label) => HELP_WANTED_LABELS.includes(label))) {
    reasons.push({
      label: 'Approachability',
      effect: 'boost',
      detail: 'Maintainers have explicitly asked for help on this one.',
    });
  }

  if (issue.commentCount > CROWDED_COMMENTS) {
    reasons.push({
      label: 'Crowding',
      effect: 'penalty',
      detail: `${issue.commentCount} comments — someone may already be working on it. Read the thread before starting.`,
    });
  }

  const idleDays = Math.round(daysSince(issue.updatedAt, now));
  if (idleDays > STALE_DAYS) {
    reasons.push({
      label: 'Staleness',
      effect: 'penalty',
      detail: `No activity for ${idleDays} days. It may be quietly dead — ask before working on it.`,
    });
  }

  reasons.push({
    label: 'Specification',
    effect: issue.bodyLength >= RICH_BODY_CHARS ? 'boost' : issue.bodyLength <= THIN_BODY_CHARS ? 'penalty' : 'neutral',
    detail:
      issue.bodyLength <= THIN_BODY_CHARS
        ? 'The description is thin, so expect to spend time working out what is actually wanted.'
        : `The description runs to ${issue.bodyLength} characters, so the work is reasonably specified.`,
  });

  return reasons;
}

function buildNotes(input: RankIssuesInput, excluded: ExcludedIssue[]): string[] {
  const notes: string[] = [];
  if (excluded.length > 0) {
    notes.push(`${excluded.length} issue(s) were filtered out as unavailable or not ready.`);
  }
  const unscored = [...input.health.values()].filter((h) => h.survivalScore === null).length;
  if (unscored > 0) {
    notes.push(`${unscored} repository(ies) could not be scored and were treated as unknown, not bad.`);
  }
  if (input.evidence.skills.length === 0) {
    notes.push('No skill evidence was available, so skill matching contributed nothing to ranking.');
  }
  return notes;
}

// --- helpers ---------------------------------------------------------------

function daysSince(iso: string, now: Date): number {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 0;
  return (now.getTime() - then) / MS_PER_DAY;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
