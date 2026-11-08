import type {
  HealthBand,
  HealthSignal,
  RepoHealth,
  RepoHealthSnapshot,
  SignalId,
} from './types';

/**
 * Repo Survival Score.
 *
 * Answers "would a contribution here plausibly get looked at?" from observable
 * maintenance behaviour. Deliberately NOT a merge probability: nothing in the
 * public API supports a calibrated probability, and inventing one would be the
 * most damaging kind of wrong this product could be.
 *
 * When a signal's data is unavailable its weight is removed from the
 * denominator rather than scored as zero — an unreadable endpoint is ignorance,
 * not evidence of neglect. If less than half the weight is observable, the
 * score is withheld entirely.
 */

const WEIGHTS: Record<SignalId, number> = {
  'maintainer-activity': 0.25,
  'merge-activity': 0.25,
  'issue-responsiveness': 0.15,
  'ci-health': 0.1,
  'release-cadence': 0.1,
  'open-pr-freshness': 0.1,
  'contributor-docs': 0.05,
};

/** Pushes decay by half every 3 months: a repo silent for a year scores ~0.06. */
const PUSH_HALF_LIFE_MONTHS = 3;
/** Releases decay more slowly; plenty of healthy projects release twice a year. */
const RELEASE_HALF_LIFE_MONTHS = 9;
/** An open PR untouched for this long is treated as stalled. */
const STALE_PR_DAYS = 90;

const MIN_COVERAGE = 0.5;
const HEALTHY_THRESHOLD = 65;
const MIXED_THRESHOLD = 40;

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const MS_PER_MONTH = MS_PER_DAY * 30.44;

export function scoreRepoHealth(snapshot: RepoHealthSnapshot, now: Date = new Date()): RepoHealth {
  const signals: HealthSignal[] = [
    maintainerActivity(snapshot, now),
    mergeActivity(snapshot),
    issueResponsiveness(snapshot),
    ciHealth(snapshot),
    releaseCadence(snapshot, now),
    openPrFreshness(snapshot, now),
    contributorDocs(snapshot),
  ];

  const observed = signals.filter((signal) => signal.value !== null);
  const observedWeight = observed.reduce((total, signal) => total + signal.weight, 0);
  const totalWeight = signals.reduce((total, signal) => total + signal.weight, 0);
  const coverage = observedWeight / totalWeight;

  const enoughData = coverage >= MIN_COVERAGE;
  const survivalScore = enoughData
    ? Math.round(
        (100 * observed.reduce((total, s) => total + s.weight * (s.value ?? 0), 0)) / observedWeight,
      )
    : null;

  const band = bandFor(survivalScore, snapshot.isArchived);

  return {
    fullName: snapshot.fullName,
    htmlUrl: snapshot.htmlUrl,
    survivalScore,
    band,
    signals,
    coverage: round2(coverage),
    archived: snapshot.isArchived,
    summary: summarise(snapshot, band, survivalScore, coverage),
  };
}

function bandFor(score: number | null, archived: boolean): HealthBand {
  if (archived) return 'risky';
  if (score === null) return 'insufficient-data';
  if (score >= HEALTHY_THRESHOLD) return 'healthy';
  if (score >= MIXED_THRESHOLD) return 'mixed';
  return 'risky';
}

function summarise(
  snapshot: RepoHealthSnapshot,
  band: HealthBand,
  score: number | null,
  coverage: number,
): string {
  if (snapshot.isArchived) {
    return 'Archived. It accepts no contributions, whatever the other signals say.';
  }
  if (score === null) {
    return `Not enough was readable to score this repo — only ${Math.round(coverage * 100)}% of the signals were available. Judge it yourself before investing time.`;
  }
  const phrase = {
    healthy: 'Maintainers look active and pull requests are being merged.',
    mixed: 'Some signs of life, but not consistently across activity, merges and responsiveness.',
    risky: 'Little evidence that contributions here get attention.',
    'insufficient-data': '',
  }[band];
  return `${phrase} Based on ${Math.round(coverage * 100)}% of the signals; this is a summary of behaviour, not a merge probability.`;
}

// --- individual signals ----------------------------------------------------

function maintainerActivity(snapshot: RepoHealthSnapshot, now: Date): HealthSignal {
  const months = monthsBetween(snapshot.pushedAt, now);
  const value = months === null ? null : halfLife(months, PUSH_HALF_LIFE_MONTHS);
  return {
    id: 'maintainer-activity',
    label: 'Maintainer activity',
    weight: WEIGHTS['maintainer-activity'],
    value,
    detail:
      months === null
        ? 'No usable last-push date.'
        : `Last push ${describeMonths(months)}.`,
  };
}

function mergeActivity(snapshot: RepoHealthSnapshot): HealthSignal {
  const closed = snapshot.closedPullRequests;
  if (closed.length === 0) {
    return unavailable('merge-activity', 'Merge activity', 'No recently closed pull requests to judge.');
  }
  const merged = closed.filter((pr) => pr.mergedAt !== null).length;
  const ratio = merged / closed.length;
  // A perfect ratio over 2 PRs says less than the same ratio over 30, so small
  // samples are shrunk toward zero rather than taken at face value.
  const sampleConfidence = Math.min(1, closed.length / 10);
  return {
    id: 'merge-activity',
    label: 'Merge activity',
    weight: WEIGHTS['merge-activity'],
    value: ratio * (0.5 + 0.5 * sampleConfidence),
    detail: `${merged} of the last ${closed.length} closed pull requests were merged.`,
  };
}

function issueResponsiveness(snapshot: RepoHealthSnapshot): HealthSignal {
  const issues = snapshot.recentIssues;
  if (issues.length === 0) {
    return unavailable(
      'issue-responsiveness',
      'Issue responsiveness',
      'No recent issues to judge.',
    );
  }
  const answered = issues.filter((issue) => issue.commentCount > 0).length;
  return {
    id: 'issue-responsiveness',
    label: 'Issue responsiveness',
    weight: WEIGHTS['issue-responsiveness'],
    value: answered / issues.length,
    detail: `${answered} of the last ${issues.length} issues received at least one reply.`,
  };
}

function ciHealth(snapshot: RepoHealthSnapshot): HealthSignal {
  const decided = snapshot.workflowRuns.filter(
    (run) => run.conclusion === 'success' || run.conclusion === 'failure',
  );
  if (decided.length === 0) {
    return unavailable('ci-health', 'CI health', 'No completed CI runs found.');
  }
  const passing = decided.filter((run) => run.conclusion === 'success').length;
  return {
    id: 'ci-health',
    label: 'CI health',
    weight: WEIGHTS['ci-health'],
    value: passing / decided.length,
    detail: `${passing} of the last ${decided.length} CI runs passed. A red main branch means your PR starts red too.`,
  };
}

function releaseCadence(snapshot: RepoHealthSnapshot, now: Date): HealthSignal {
  if (!snapshot.latestReleaseAt) {
    return unavailable('release-cadence', 'Release cadence', 'No published releases.');
  }
  const months = monthsBetween(snapshot.latestReleaseAt, now);
  return {
    id: 'release-cadence',
    label: 'Release cadence',
    weight: WEIGHTS['release-cadence'],
    value: months === null ? null : halfLife(months, RELEASE_HALF_LIFE_MONTHS),
    detail: months === null ? 'Unreadable release date.' : `Latest release ${describeMonths(months)}.`,
  };
}

function openPrFreshness(snapshot: RepoHealthSnapshot, now: Date): HealthSignal {
  const open = snapshot.openPullRequests;
  if (open.length === 0) {
    return unavailable('open-pr-freshness', 'Open PR freshness', 'No open pull requests.');
  }
  const stale = open.filter((pr) => {
    const days = (now.getTime() - new Date(pr.updatedAt).getTime()) / MS_PER_DAY;
    return Number.isFinite(days) && days > STALE_PR_DAYS;
  }).length;
  return {
    id: 'open-pr-freshness',
    label: 'Open PR freshness',
    weight: WEIGHTS['open-pr-freshness'],
    value: 1 - stale / open.length,
    detail: `${stale} of ${open.length} open pull requests have sat untouched for over ${STALE_PR_DAYS} days.`,
  };
}

function contributorDocs(snapshot: RepoHealthSnapshot): HealthSignal {
  // Without the community profile we do not know whether these files exist.
  // Reporting "none found" would punish the repo for our own missing request.
  if (snapshot.unavailable.includes('community profile')) {
    return unavailable(
      'contributor-docs',
      'Contributor documentation',
      'Contributor docs were not checked for this repository.',
    );
  }

  const found = [
    snapshot.hasContributingDoc ? 'CONTRIBUTING' : null,
    snapshot.hasIssueTemplates ? 'issue templates' : null,
  ].filter(Boolean);

  return {
    id: 'contributor-docs',
    label: 'Contributor documentation',
    weight: WEIGHTS['contributor-docs'],
    value: found.length / 2,
    detail:
      found.length === 0
        ? 'No CONTRIBUTING guide or issue templates — expect to guess at house rules.'
        : `Found ${found.join(' and ')}.`,
  };
}

// --- helpers ---------------------------------------------------------------

function unavailable(id: SignalId, label: string, detail: string): HealthSignal {
  return { id, label, weight: WEIGHTS[id], value: null, detail };
}

function halfLife(months: number, halfLifeMonths: number): number {
  return months <= 0 ? 1 : 0.5 ** (months / halfLifeMonths);
}

function monthsBetween(iso: string, now: Date): number | null {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  return (now.getTime() - then) / MS_PER_MONTH;
}

function describeMonths(months: number): string {
  if (months < 0.25) return 'within the last week';
  if (months < 1) return 'within the last month';
  if (months < 2) return 'about a month ago';
  if (months < 12) return `about ${Math.round(months)} months ago`;
  return `over ${Math.floor(months / 12)} year${months >= 24 ? 's' : ''} ago`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
