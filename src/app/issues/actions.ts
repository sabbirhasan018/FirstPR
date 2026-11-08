'use server';

import { revalidatePath } from 'next/cache';
import { resolveGitHubToken } from '@/lib/auth/github-token';
import { getSession } from '@/lib/auth/session';
import { discoverIssues } from '@/lib/services/discover-issues';
import { getStore } from '@/lib/store';
import type { DiscoverFormState } from './discover-state';

export async function discoverIssuesAction(): Promise<DiscoverFormState> {
  const session = await getSession();
  if (!session) {
    return { status: 'error', message: 'Sign in before searching for issues.' };
  }

  const store = await getStore();
  const latest = await store.latestImport(session.userId);
  if (!latest) {
    return {
      status: 'error',
      message: 'Import a GitHub profile first — ranking needs your evidenced skills.',
    };
  }

  const result = await discoverIssues({
    evidence: latest.report,
    githubToken: resolveGitHubToken(session).token,
  });
  if (!result.ok) {
    return { status: 'error', message: result.error };
  }

  await store.saveDiscovery({
    userId: session.userId,
    languages: latest.report.skills
      .filter((skill) => skill.category === 'language')
      .map((skill) => skill.label),
    requestsUsed: result.requestsUsed,
    excludedCount: result.ranking.excluded.length,
    ranking: result.ranking,
    health: result.health,
  });

  revalidatePath('/issues');

  return {
    status: 'success',
    message: `Ranked ${result.ranking.ranked.length} issues across ${result.health.length} scored repositories, using ${result.requestsUsed} GitHub requests.`,
  };
}
