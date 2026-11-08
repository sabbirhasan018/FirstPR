import { describe, expect, it } from 'vitest';
import { deriveEvidence } from '@/lib/evidence/engine';
import { FIXTURE_NOW, sampleSnapshot } from '@/lib/evidence/fixtures';
import { createMemoryStore } from './memory';

const snapshot = sampleSnapshot();
const report = deriveEvidence(snapshot, FIXTURE_NOW);

const input = (userId: string) => ({
  userId,
  githubLogin: snapshot.login,
  snapshot,
  report,
});

describe('memory store', () => {
  it('returns the most recent import first', async () => {
    const store = createMemoryStore();
    const first = await store.saveImport(input('user-a'));
    const second = await store.saveImport(input('user-a'));

    expect((await store.latestImport('user-a'))?.id).toBe(second.id);
    expect((await store.listImports('user-a')).map((i) => i.id)).toEqual([second.id, first.id]);
  });

  it('keeps each user’s imports separate', async () => {
    const store = createMemoryStore();
    await store.saveImport(input('user-a'));

    expect(await store.latestImport('user-b')).toBeNull();
    expect(await store.listImports('user-b')).toEqual([]);
  });

  it('keeps discovery runs per user and returns the newest', async () => {
    const store = createMemoryStore();
    const discovery = {
      userId: 'user-a',
      languages: ['TypeScript'],
      requestsUsed: 12,
      excludedCount: 3,
      ranking: { ranked: [], excluded: [], notes: ['first'] },
      health: [],
    };

    await store.saveDiscovery(discovery);
    const second = await store.saveDiscovery({ ...discovery, requestsUsed: 20 });

    expect((await store.latestDiscovery('user-a'))?.id).toBe(second.id);
    expect(await store.latestDiscovery('user-b')).toBeNull();
  });

  it('round-trips the report with its citations intact', async () => {
    const store = createMemoryStore();
    await store.saveImport(input('user-a'));

    const loaded = await store.latestImport('user-a');
    expect(loaded?.report.skills.length).toBe(report.skills.length);
    expect(loaded?.report.skills[0].citations.length).toBeGreaterThan(0);
  });
});
