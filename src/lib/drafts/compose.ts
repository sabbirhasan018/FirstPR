import type { PreflightInput } from '@/lib/preflight/types';

/**
 * Drafts for talking to maintainers.
 *
 * Deterministic templates, not generated prose. Two reasons. A model writing
 * "I noticed a small issue and would love to help!" produces exactly the
 * enthusiastic, content-free comment maintainers complain about; and a draft
 * that invents detail the contributor has not verified is worse than no draft.
 *
 * So every template is a scaffold with the user's own facts slotted in, and any
 * gap is left as an explicit placeholder for them to fill rather than guessed at.
 * Nothing here is ever posted — these are text to read, edit and paste.
 */

export type DraftKind = 'pr-description' | 'issue-claim' | 'nudge' | 'review-response';

export type Draft = {
  kind: DraftKind;
  title: string;
  /** Why this draft says what it says, so the user can disagree with it. */
  rationale: string;
  body: string;
  /** Placeholders the user still has to fill in. */
  placeholders: string[];
};

const PLACEHOLDER = /<([^>]+)>/g;

function placeholdersIn(body: string): string[] {
  return [...new Set(Array.from(body.matchAll(PLACEHOLDER), (match) => match[1]))];
}

function draft(kind: DraftKind, title: string, rationale: string, body: string): Draft {
  const trimmed = body.trim();
  return { kind, title, rationale, body: trimmed, placeholders: placeholdersIn(trimmed) };
}

export type ComposeContext = {
  repoFullName: string;
  issueNumber: number | null;
  issueTitle: string | null;
  /** Rule ids extracted from the repository, e.g. 'dco', 'conventional-commits'. */
  contributorRuleIds: string[];
  /** Test command the repository defines, if one was found. */
  testCommand: string | null;
};

/**
 * A pull request description built from what actually changed.
 *
 * Structured as problem, change, verification — the three things a reviewer
 * looks for, in the order they look for them.
 */
export function composePrDescription(input: PreflightInput, context: ComposeContext): Draft {
  const files = input.changedFiles;
  const lines = files.reduce((total, file) => total + file.added + file.removed, 0);
  const testFiles = files.filter((file) =>
    /(^|\/)(tests?|spec|__tests__)\/|\.(test|spec)\.[jt]sx?$/.test(file.path),
  );

  const closes = context.issueNumber ? `Closes #${context.issueNumber}.` : 'Closes #<issue number>.';
  const verification = testFiles.length
    ? `Added ${testFiles.length} test${testFiles.length === 1 ? '' : 's'} (${testFiles
        .map((file) => file.path)
        .slice(0, 3)
        .join(', ')}).${context.testCommand ? ` Verified with \`${context.testCommand}\`.` : ''}`
    : `<how you verified this>${context.testCommand ? ` — the repository's suite is \`${context.testCommand}\`` : ''}`;

  const body = `## What

<one sentence on the behaviour that was wrong, or the gap being filled>

## Why

${context.issueTitle ? `${context.issueTitle}\n\n${closes}` : closes}

## How

${files
  .slice(0, 8)
  .map((file) => `- \`${file.path}\` — <what changed here and why>`)
  .join('\n')}${files.length > 8 ? `\n- …and ${files.length - 8} more file(s)` : ''}

## Verification

${verification}

---

${lines} line(s) changed across ${files.length} file(s).`;

  return draft(
    'pr-description',
    'Pull request description',
    'Problem, change, verification — the three things a reviewer looks for, in that order. The file list comes from your diff; the reasoning is left for you, because a description that invents a rationale you did not have is worse than none.',
    body,
  );
}

/**
 * A comment asking to take an issue. Short on purpose: maintainers read a lot
 * of these, and a paragraph of enthusiasm costs them time without telling them
 * anything.
 */
export function composeIssueClaim(context: ComposeContext): Draft {
  const reference = context.issueNumber ? `#${context.issueNumber}` : 'this issue';

  const body = `I'd like to work on ${reference}.

My read is that <your one-line understanding of the problem>. I was planning to <the approach you intend to take>.

Does that match what you had in mind? Happy to adjust before I start.`;

  return draft(
    'issue-claim',
    'Asking to take the issue',
    'States your understanding and your intended approach, so a maintainer can redirect you in one reply rather than at review time. Deliberately short — "can I work on this?" with no substance forces them to do the thinking for you.',
    body,
  );
}

/** A polite follow-up on a pull request that has gone quiet. */
export function composeNudge(daysWaiting: number): Draft {
  const body = `Just checking in on this one — no rush if you're busy.

Happy to rebase or split it up if that would make it easier to review. If the approach isn't right, I'd rather know now than keep it open.`;

  return draft(
    'nudge',
    `Following up after ${daysWaiting} day${daysWaiting === 1 ? '' : 's'}`,
    'Offers to make the reviewer\'s job easier and gives them an easy way to say no. Nudging without an offer reads as pressure, which is what gets a pull request quietly ignored.',
    body,
  );
}

/** A reply to review feedback that asks for a change. */
export function composeReviewResponse(): Draft {
  const body = `Thanks — updated in <commit sha>.

<If you disagreed with something, say so here with your reasoning, briefly. Maintainers would rather discuss it than have you silently comply with something you think is wrong.>`;

  return draft(
    'review-response',
    'Responding to review feedback',
    'Points at the commit that addressed the comment so the reviewer can check it in one click, and leaves explicit room for disagreement — silently complying with a change you think is wrong helps nobody.',
    body,
  );
}

export function composeAllDrafts(input: PreflightInput, context: ComposeContext): Draft[] {
  return [
    composePrDescription(input, context),
    composeIssueClaim(context),
    composeReviewResponse(),
  ];
}
