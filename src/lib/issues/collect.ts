import type { GitHubClient } from '@/lib/github/client';
import { issueSearchSchema } from '@/lib/github/discovery-schemas';
import type { IssueCandidate } from './types';

/** Candidates requested per language query. */
export const RESULTS_PER_LANGUAGE = 25;

/**
 * Searches open, unassigned issues in the languages a user has actually
 * evidenced.
 *
 * The query deliberately does NOT filter on "good first issue". Filtering on
 * the label is the naive baseline this ranking has to beat, and it drops the
 * many workable issues maintainers never label. Selection is left to the
 * ranker, which can explain itself.
 *
 * GitHub's search qualifiers cannot express OR across languages, so this costs
 * one request per language.
 */
export async function searchIssuesByLanguage(
  languages: string[],
  client: GitHubClient,
): Promise<{ candidates: IssueCandidate[]; warnings: string[] }> {
  const candidates = new Map<number, IssueCandidate>();
  const warnings: string[] = [];

  for (const language of languages) {
    const query = `is:issue is:open no:assignee archived:false language:${language}`;
    const result = await client.get(
      `/search/issues?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=${RESULTS_PER_LANGUAGE}`,
      issueSearchSchema,
    );

    if (!result) {
      warnings.push(`No search results returned for ${language}.`);
      continue;
    }
    if (result.incomplete_results) {
      warnings.push(`GitHub timed out partway through the ${language} search; results are partial.`);
    }

    for (const item of result.items) {
      candidates.set(item.id, {
        id: item.id,
        number: item.number,
        title: item.title,
        url: item.html_url,
        repoFullName: item.repository_url.replace(/^.*\/repos\//, ''),
        labels: item.labels.map((label) => label.name),
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        commentCount: item.comments,
        // `no:assignee` should make this always false; trust the payload, not the query.
        hasAssignee: item.assignee != null || item.assignees.length > 0,
        bodyLength: item.body?.length ?? 0,
        searchedLanguage: language,
      });
    }
  }

  return { candidates: [...candidates.values()], warnings };
}
