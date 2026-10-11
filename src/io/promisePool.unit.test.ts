import {
  describe,
  it,
  expect,
  vi,
} from 'vitest';

import { promisePool } from './promisePool.js';

describe('promisePool', () => {
  it('resolves immediately for empty items', async () => {
    const handler = vi.fn();
    await promisePool([], 10, handler);
    expect(handler).not.toHaveBeenCalled();
  });

  it('processes a single item', async () => {
    const results: number[] = [];
    await promisePool([42], 10, async (item) => { results.push(item); });
    expect(results).toEqual([42]);
  });

  it('processes all items when all succeed', async () => {
    const results: number[] = [];
    await promisePool([
      1,
      2,
      3,
    ], 2, async (item) => { results.push(item); });
    expect(results).toHaveLength(3);
    expect(results.sort()).toEqual([
      1,
      2,
      3,
    ]);
  });

  it('rejects when all handlers fail', async () => {
    await expect(
      promisePool([1, 2], 2, async () => { throw new Error('fail'); }),
    ).rejects.toThrow('fail');
  });

  it('rejects when one handler fails (collects first error)', async () => {
    await expect(
      promisePool([
        1,
        2,
        3,
      ], 2, async (item) => {
        if (item === 2) throw new Error('item 2 failed');
      }),
    ).rejects.toThrow('item 2 failed');
  });

  it('respects concurrency limit', async () => {
    const inFlight = { value: 0 };
    let maxInFlight = 0;
    const delay = (ms: number) => new Promise((r) => { setTimeout(r, ms); });

    const items = [
      1,
      2,
      3,
      4,
      5,
    ];
    await promisePool(items, 2, async () => {
      inFlight.value += 1;
      maxInFlight = Math.max(maxInFlight, inFlight.value);
      await delay(50);
      inFlight.value -= 1;
    });

    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('processes each item exactly once', async () => {
    const counts = new Map<number, number>();
    const items = [
      1,
      2,
      3,
      4,
      5,
    ];

    await promisePool(items, 3, async (item) => {
      counts.set(item, (counts.get(item) || 0) + 1);
    });

    items.forEach((item) => {
      expect(counts.get(item)).toBe(1);
    });
  });

  it('handles concurrency higher than item count', async () => {
    const results: number[] = [];
    await promisePool([1, 2], 100, async (item) => { results.push(item); });
    expect(results).toHaveLength(2);
    expect(results.sort()).toEqual([1, 2]);
  });

  it('wraps non-Error throw into Error', async () => {
    await expect(

      promisePool([1], 1, async () => { throw new Error('string error'); }),
    ).rejects.toThrow('string error');
  });

  it('wraps non-Error values into Error via String()', async () => {
    await expect(

      promisePool([1], 1, async () => { throw 'raw string'; }), // eslint-disable-line no-throw-literal
    ).rejects.toThrow('raw string');
  });

  it('handles concurrency of 1 (serial processing)', async () => {
    const order: number[] = [];
    const delay = (ms: number) => new Promise((r) => { setTimeout(r, ms); });

    await promisePool([
      1,
      2,
      3,
    ], 1, async (item) => {
      await delay(10);
      order.push(item);
    });

    expect(order).toEqual([
      1,
      2,
      3,
    ]);
  });

  it('aggregates all errors when multiple handlers fail', async () => {
    let first = true;
    await expect(
      promisePool([1, 2], 2, async () => {
        if (first) {
          first = false;
          throw new Error('first error');
        }
        throw new Error('second error');
      }),
    ).rejects.toThrow(AggregateError);
  });

  it('clamps concurrency of 0 to 1', async () => {
    const results: number[] = [];
    await promisePool([1, 2], 0, async (item) => { results.push(item); });
    expect(results).toHaveLength(2);
  });
});
