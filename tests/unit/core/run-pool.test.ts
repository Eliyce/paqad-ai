import { describe, expect, it } from 'vitest';

import { runPool } from '@/core/run-pool.js';

describe('runPool', () => {
  it('keeps results in input order when later items finish first', async () => {
    const delays = [30, 20, 10, 0];
    const finished: number[] = [];
    const results = await runPool(delays, 4, async (delay, index) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      finished.push(index);
      return index * 10;
    });
    expect(finished).toEqual([3, 2, 1, 0]);
    expect(results).toEqual([0, 10, 20, 30]);
  });

  it('never runs more items at once than the limit', async () => {
    let running = 0;
    let peak = 0;
    await runPool([1, 2, 3, 4, 5, 6], 2, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
    });
    expect(peak).toBe(2);
  });

  it('runs one at a time with a limit below one and returns nothing for no items', async () => {
    const order: number[] = [];
    await runPool([1, 2, 3], 0, async (item) => {
      order.push(item);
    });
    expect(order).toEqual([1, 2, 3]);
    expect(await runPool([], 4, async () => 1)).toEqual([]);
  });
});
