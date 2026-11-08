/**
 * Map over items with a bounded number of in-flight tasks, preserving input
 * order in the results.
 *
 * Sequential I/O is the wrong default when each item costs a network round
 * trip: scanning 44 repositories one at a time takes minutes, almost all of it
 * spent waiting. The bound matters as much as the parallelism — GitHub enforces
 * secondary rate limits on bursts, so this is deliberately a small number of
 * workers rather than "fire everything at once".
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}
