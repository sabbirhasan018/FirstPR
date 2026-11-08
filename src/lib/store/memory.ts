import { randomUUID } from 'node:crypto';
import type { EvidenceStore, StoredDiscovery, StoredImport } from './types';

/**
 * In-memory store for local mode. Data lives for the lifetime of the server
 * process only — the UI says so explicitly rather than pretending it persists.
 */
export function createMemoryStore(): EvidenceStore {
  const byUser = new Map<string, StoredImport[]>();
  const discoveriesByUser = new Map<string, StoredDiscovery[]>();

  return {
    async saveDiscovery(input) {
      const record: StoredDiscovery = {
        ...input,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      };
      const existing = discoveriesByUser.get(input.userId) ?? [];
      discoveriesByUser.set(input.userId, [record, ...existing]);
      return record;
    },

    async latestDiscovery(userId) {
      return discoveriesByUser.get(userId)?.[0] ?? null;
    },

    async saveImport(input) {
      const record: StoredImport = {
        ...input,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      };
      const existing = byUser.get(input.userId) ?? [];
      byUser.set(input.userId, [record, ...existing]);
      return record;
    },

    async latestImport(userId) {
      return byUser.get(userId)?.[0] ?? null;
    },

    async listImports(userId) {
      return [...(byUser.get(userId) ?? [])];
    },
  };
}

/**
 * A single process-wide instance. Next.js re-evaluates modules on hot reload,
 * so it is stashed on globalThis to survive that in development.
 */
const globalForStore = globalThis as unknown as { __firstprMemoryStore?: EvidenceStore };

export function sharedMemoryStore(): EvidenceStore {
  globalForStore.__firstprMemoryStore ??= createMemoryStore();
  return globalForStore.__firstprMemoryStore;
}
