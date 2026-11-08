'use server';

import { collectPreflight, PreflightError } from '@/lib/preflight/collect';
import { runPreflight } from '@/lib/preflight/engine';
import { composeAllDrafts } from '@/lib/drafts/compose';
import type { PreflightFormState } from './preflight-state';

function optionalIssueNumber(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = Number(text.replace(/^#/, ''));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function runPreflightAction(
  _previous: PreflightFormState,
  formData: FormData,
): Promise<PreflightFormState> {
  try {
    const { input, diffText } = await collectPreflight({
      repoPath: String(formData.get('repoPath') ?? ''),
      baseBranch: String(formData.get('baseBranch') ?? ''),
      prTitle: String(formData.get('prTitle') ?? '') || null,
      prBody: String(formData.get('prBody') ?? '') || null,
      linkedIssue: optionalIssueNumber(formData.get('linkedIssue')),
      contributorRuleIds: formData.getAll('rules').map(String),
      hasTestCommand: formData.get('hasTestCommand') === 'on',
    });

    return {
      status: 'ready',
      message: `Checked ${input.branch} against ${input.baseBranch}.`,
      report: runPreflight(input, { diffText }),
      drafts: composeAllDrafts(input, {
        repoFullName: String(formData.get('repoFullName') ?? '') || 'the repository',
        issueNumber: optionalIssueNumber(formData.get('linkedIssue')),
        issueTitle: null,
        contributorRuleIds: formData.getAll('rules').map(String),
        testCommand: formData.get('hasTestCommand') === 'on' ? 'the repository test suite' : null,
      }),
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof PreflightError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Preflight failed for an unknown reason.',
      report: null,
      drafts: [],
    };
  }
}
