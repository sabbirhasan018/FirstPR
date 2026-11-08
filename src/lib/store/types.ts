import type { EvidenceReport } from '@/lib/evidence/types';
import type { ProfileSnapshot } from '@/lib/github/types';
import type { RepoHealth } from '@/lib/health/types';
import type { IssueRanking } from '@/lib/issues/types';

export type StoredImport = {
  id: string;
  userId: string;
  githubLogin: string;
  createdAt: string;
  snapshot: ProfileSnapshot;
  report: EvidenceReport;
};

/**
 * Persistence contract for evidence imports. Implemented in-memory for local
 * development and against Supabase/Postgres in deployed environments, so the
 * rest of the app never knows which is in play.
 */
/** One issue-discovery run: the ranking, and the repo health behind it. */
export type StoredDiscovery = {
  id: string;
  userId: string;
  createdAt: string;
  languages: string[];
  requestsUsed: number;
  /**
   * How many candidates were filtered out. Tracked separately from
   * `ranking.excluded` because the excluded issues themselves are not persisted,
   * only their count — and a UI reporting "0 filtered out" after discarding
   * dozens would be worse than useless.
   */
  excludedCount: number;
  ranking: IssueRanking;
  health: RepoHealth[];
};

export type EvidenceStore = {
  saveImport(input: Omit<StoredImport, 'id' | 'createdAt'>): Promise<StoredImport>;
  latestImport(userId: string): Promise<StoredImport | null>;
  listImports(userId: string): Promise<StoredImport[]>;
  saveDiscovery(input: Omit<StoredDiscovery, 'id' | 'createdAt'>): Promise<StoredDiscovery>;
  latestDiscovery(userId: string): Promise<StoredDiscovery | null>;
};
