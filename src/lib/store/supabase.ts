import type { SupabaseClient } from '@supabase/supabase-js';
import type { EvidenceReport } from '@/lib/evidence/types';
import type { ProfileSnapshot } from '@/lib/github/types';
import type { RepoHealth } from '@/lib/health/types';
import type { RankedIssue } from '@/lib/issues/types';
import type { EvidenceStore, StoredImport } from './types';

/**
 * Supabase/Postgres store. All access goes through the caller's session client,
 * so row level security — not application code — is what enforces ownership.
 */
export function createSupabaseStore(client: SupabaseClient): EvidenceStore {
  return {
    async saveImport({ userId, githubLogin, snapshot, report }) {
      const { data: inserted, error } = await client
        .from('evidence_snapshots')
        .insert({
          user_id: userId,
          github_login: githubLogin,
          collected_at: snapshot.collectedAt,
          generated_at: report.generatedAt,
          raw_snapshot: snapshot,
          notes: report.notes,
        })
        .select('id, created_at')
        .single();

      if (error) throw new Error(`Failed to save snapshot: ${error.message}`);

      for (const skill of report.skills) {
        const { data: skillRow, error: skillError } = await client
          .from('skill_evidence')
          .insert({
            snapshot_id: inserted.id,
            user_id: userId,
            skill_id: skill.skillId,
            label: skill.label,
            category: skill.category,
            confidence: skill.confidence,
            score: skill.score,
            breadth: skill.breadth,
            freshness: skill.freshness,
            depth: skill.depth,
            repo_count: skill.repoCount,
            last_observed_at: skill.lastObservedAt,
            rationale: skill.rationale,
          })
          .select('id')
          .single();

        if (skillError) throw new Error(`Failed to save skill evidence: ${skillError.message}`);

        const { error: citationError } = await client.from('evidence_citations').insert(
          skill.citations.map((citation) => ({
            skill_evidence_id: skillRow.id,
            user_id: userId,
            kind: citation.kind,
            repo: citation.repo,
            detail: citation.detail,
            url: citation.url,
          })),
        );

        if (citationError) throw new Error(`Failed to save citations: ${citationError.message}`);
      }

      return {
        id: inserted.id,
        userId,
        githubLogin,
        createdAt: inserted.created_at,
        snapshot,
        report,
      };
    },

    async latestImport(userId) {
      const { data, error } = await client
        .from('evidence_snapshots')
        .select('id, user_id, github_login, created_at, raw_snapshot, generated_at, notes')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw new Error(`Failed to load snapshot: ${error.message}`);
      return data ? await hydrate(client, data) : null;
    },

    async listImports(userId) {
      const { data, error } = await client
        .from('evidence_snapshots')
        .select('id, user_id, github_login, created_at, raw_snapshot, generated_at, notes')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw new Error(`Failed to list snapshots: ${error.message}`);
      return Promise.all((data ?? []).map((row) => hydrate(client, row)));
    },

    async saveDiscovery({ userId, languages, requestsUsed, excludedCount, ranking, health }) {
      const { data: run, error } = await client
        .from('discovery_runs')
        .insert({
          user_id: userId,
          languages,
          notes: ranking.notes,
          requests_used: requestsUsed,
          excluded_count: excludedCount,
        })
        .select('id, created_at')
        .single();

      if (error) throw new Error(`Failed to save discovery run: ${error.message}`);

      if (health.length > 0) {
        const { error: healthError } = await client.from('repo_health').insert(
          health.map((repo) => ({
            run_id: run.id,
            user_id: userId,
            full_name: repo.fullName,
            html_url: repo.htmlUrl,
            survival_score: repo.survivalScore,
            band: repo.band,
            coverage: repo.coverage,
            archived: repo.archived,
            summary: repo.summary,
            signals: repo.signals,
          })),
        );
        if (healthError) throw new Error(`Failed to save repo health: ${healthError.message}`);
      }

      if (ranking.ranked.length > 0) {
        const { error: issueError } = await client.from('ranked_issues').insert(
          ranking.ranked.map((entry, index) => ({
            run_id: run.id,
            user_id: userId,
            github_issue_id: entry.issue.id,
            issue_number: entry.issue.number,
            title: entry.issue.title,
            url: entry.issue.url,
            repo_full_name: entry.issue.repoFullName,
            labels: entry.issue.labels,
            score: entry.score,
            rank: index,
            matched_skills: entry.matchedSkills,
            reasons: entry.reasons,
            comment_count: entry.issue.commentCount,
            body_length: entry.issue.bodyLength,
            issue_created_at: entry.issue.createdAt,
            issue_updated_at: entry.issue.updatedAt,
          })),
        );
        if (issueError) throw new Error(`Failed to save ranked issues: ${issueError.message}`);
      }

      return {
        id: run.id,
        userId,
        createdAt: run.created_at,
        languages,
        requestsUsed,
        excludedCount,
        ranking,
        health,
      };
    },

    async latestDiscovery(userId) {
      const { data: run, error } = await client
        .from('discovery_runs')
        .select('id, created_at, languages, notes, requests_used, excluded_count')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw new Error(`Failed to load discovery run: ${error.message}`);
      if (!run) return null;

      const [{ data: healthRows, error: healthError }, { data: issueRows, error: issueError }] =
        await Promise.all([
          client.from('repo_health').select('*').eq('run_id', run.id),
          client.from('ranked_issues').select('*').eq('run_id', run.id).order('rank'),
        ]);

      if (healthError) throw new Error(`Failed to load repo health: ${healthError.message}`);
      if (issueError) throw new Error(`Failed to load ranked issues: ${issueError.message}`);

      const health: RepoHealth[] = (healthRows ?? []).map((row) => ({
        fullName: row.full_name,
        htmlUrl: row.html_url,
        survivalScore: row.survival_score,
        band: row.band,
        coverage: Number(row.coverage),
        archived: row.archived,
        summary: row.summary,
        signals: row.signals ?? [],
      }));

      const ranked: RankedIssue[] = (issueRows ?? []).map((row) => ({
        score: row.score,
        matchedSkills: row.matched_skills ?? [],
        reasons: row.reasons ?? [],
        issue: {
          id: Number(row.github_issue_id),
          number: row.issue_number,
          title: row.title,
          url: row.url,
          repoFullName: row.repo_full_name,
          labels: row.labels ?? [],
          createdAt: row.issue_created_at,
          updatedAt: row.issue_updated_at,
          commentCount: row.comment_count,
          hasAssignee: false,
          bodyLength: row.body_length,
          // Only used while ranking; not worth a column to replay after the fact.
          searchedLanguage: null,
        },
      }));

      return {
        id: run.id,
        userId,
        createdAt: run.created_at,
        languages: run.languages ?? [],
        requestsUsed: run.requests_used,
        excludedCount: run.excluded_count ?? 0,
        // The excluded issues themselves are not stored, only their count.
        ranking: { ranked, excluded: [], notes: run.notes ?? [] },
        health,
      };
    },
  };
}

type SnapshotRow = {
  id: string;
  user_id: string;
  github_login: string;
  created_at: string;
  generated_at: string;
  raw_snapshot: unknown;
  notes: string[];
};

async function hydrate(client: SupabaseClient, row: SnapshotRow): Promise<StoredImport> {
  const { data, error } = await client
    .from('skill_evidence')
    .select(
      'skill_id, label, category, confidence, score, breadth, freshness, depth, repo_count, last_observed_at, rationale, evidence_citations (kind, repo, detail, url)',
    )
    .eq('snapshot_id', row.id)
    .order('score', { ascending: false });

  if (error) throw new Error(`Failed to load skill evidence: ${error.message}`);

  const snapshot = row.raw_snapshot as ProfileSnapshot;
  const report: EvidenceReport = {
    login: row.github_login,
    generatedAt: row.generated_at,
    notes: row.notes ?? [],
    unmatchedRepos: [],
    skills: (data ?? []).map((skill) => ({
      skillId: skill.skill_id,
      label: skill.label,
      category: skill.category,
      confidence: skill.confidence,
      score: skill.score,
      breadth: Number(skill.breadth),
      freshness: Number(skill.freshness),
      depth: Number(skill.depth),
      repoCount: skill.repo_count,
      lastObservedAt: skill.last_observed_at,
      rationale: skill.rationale,
      citations: skill.evidence_citations ?? [],
    })),
  };

  return {
    id: row.id,
    userId: row.user_id,
    githubLogin: row.github_login,
    createdAt: row.created_at,
    snapshot,
    report,
  };
}
