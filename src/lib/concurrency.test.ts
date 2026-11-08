import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './concurrency';

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe('mapWithConcurrency', () => {
  it('returns results in input order regardless of completion order', async () => {
    const result = await mapWithConcurrency([30, 10, 20, 0], 4, async (delay) => {
      await tick(delay);
      return delay;
    });
    expect(result).toEqual([30, 10, 20, 0]);
  });

  it('never exceeds the concurrency limit', async () => {
    let running = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await tick(1);
      running -= 1;
    });

    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it('processes every item exactly once', async () => {
    const seen: number[] = [];
    await mapWithConcurrency(Array.from({ length: 15 }, (_, i) => i), 5, async (item) => {
      await tick(1);
      seen.push(item);
    });
    expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i));
  });

  it('handles an empty list and a limit larger than the list', async () => {
    expect(await mapWithConcurrency([], 5, async () => 1)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 99, async (n) => n * 2)).toEqual([2, 4]);
  });

  it('propagates a rejection from the mapper', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});
