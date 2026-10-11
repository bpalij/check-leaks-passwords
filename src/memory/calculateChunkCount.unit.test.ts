import { describe, it, expect } from 'vitest';

import { calculateChunkCount } from './calculateChunkCount.js';
import { MAX_CHUNKS, MBPS_PER_CHUNK } from '../constants.js';

const DEFAULT_PARAMS = {
  iopMBps: 500,
  availableMemBytes: 8 * 1024 * 1024 * 1024,
  mapCloneBytes: 1024 * 1024,
  serializedSetBytes: 512 * 1024,
  cpuParallelism: 16,
  highWaterMark: 16 * 1024 * 1024,
  readAhead: 2,
};

describe('calculateChunkCount', () => {
  it('returns 1 when speed is below MBPS_PER_CHUNK', () => {
    const result = calculateChunkCount({ ...DEFAULT_PARAMS, iopMBps: 100 });
    expect(result).toBe(1);
  });

  it('scales with drive speed', () => {
    const result = calculateChunkCount({ ...DEFAULT_PARAMS, iopMBps: 900 });
    expect(result).toBe(Math.floor(900 / MBPS_PER_CHUNK) + 1);
  });

  it('is capped by CPU parallelism', () => {
    const result = calculateChunkCount({ ...DEFAULT_PARAMS, cpuParallelism: 4 });
    expect(result).toBeLessThanOrEqual(4);
  });

  it('is capped by MAX_CHUNKS', () => {
    const result = calculateChunkCount({
      ...DEFAULT_PARAMS,
      iopMBps: 100_000,
      cpuParallelism: 1000,
      availableMemBytes: 1024 * 1024 * 1024 * 1024,
    });
    expect(result).toBe(MAX_CHUNKS);
  });

  it('is capped by available memory', () => {
    const lowMem = calculateChunkCount({
      ...DEFAULT_PARAMS, availableMemBytes: 256 * 1024 * 1024,
    });
    const highMem = calculateChunkCount({
      ...DEFAULT_PARAMS,
      availableMemBytes: 64 * 1024 * 1024 * 1024,
    });
    expect(lowMem).toBeLessThanOrEqual(highMem);
  });

  it('accounts for mapCloneBytes and serializedSetBytes in memory budget', () => {
    const small = calculateChunkCount({
      ...DEFAULT_PARAMS, mapCloneBytes: 1024, serializedSetBytes: 512,
    });
    const large = calculateChunkCount({
      ...DEFAULT_PARAMS,
      mapCloneBytes: 1024 * 1024 * 100,
      serializedSetBytes: 1024 * 1024 * 100,
    });
    expect(small).toBeGreaterThanOrEqual(large);
  });

  it('returns at least 1', () => {
    const result = calculateChunkCount({
      ...DEFAULT_PARAMS,
      iopMBps: 1,
      cpuParallelism: 1,
      availableMemBytes: 1024 * 1024,
    });
    expect(result).toBeGreaterThanOrEqual(1);
  });

  it('higher readAhead reduces chunk count (more memory per chunk)', () => {
    const low = calculateChunkCount({ ...DEFAULT_PARAMS, readAhead: 1 });
    const high = calculateChunkCount({ ...DEFAULT_PARAMS, readAhead: 8 });
    expect(low).toBeGreaterThanOrEqual(high);
  });
});
