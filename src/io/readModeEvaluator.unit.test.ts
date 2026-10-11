import os from 'os';

import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';

import {
  effectiveIOConcurrency,
  sequentialReadTimeMs,
  indexReadTimeMs,
  indexSlowerThanSeq,
  estimatedBinaryTimeMs,
  maxBinaryHashes,
  evaluateReadMode,
} from './readModeEvaluator.js';

vi.mock('../memory/getAvailableMemBytes', () => ({
  getAvailableMemBytes: () => 32 * 1024 * 1024 * 1024,
}));

describe('effectiveIOConcurrency', () => {
  const origEnv = process.env.UV_THREADPOOL_SIZE;

  beforeEach(() => {
    delete process.env.UV_THREADPOOL_SIZE;
  });

  afterEach(() => {
    if (origEnv !== undefined) process.env.UV_THREADPOOL_SIZE = origEnv;
    else delete process.env.UV_THREADPOOL_SIZE;
  });

  it('caps at count when count is smallest', () => {
    const result = effectiveIOConcurrency(2);
    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBeLessThanOrEqual(2);
  });

  it('caps at threadpool size from env', () => {
    process.env.UV_THREADPOOL_SIZE = '4';
    const result = effectiveIOConcurrency(100);
    expect(result).toBeLessThanOrEqual(4);
  });

  it('caps at threadpool size from os.availableParallelism when env invalid', () => {
    process.env.UV_THREADPOOL_SIZE = 'invalid';
    const result = effectiveIOConcurrency(100);
    expect(result).toBeLessThanOrEqual(os.availableParallelism());
  });

  it('uses os.availableParallelism when UV_THREADPOOL_SIZE not set', () => {
    const result = effectiveIOConcurrency(100);
    expect(result).toBeLessThanOrEqual(os.availableParallelism());
  });

  it('returns at least 1 for count = 1', () => {
    const result = effectiveIOConcurrency(1);
    expect(result).toBe(1);
  });
});

describe('sequentialReadTimeMs', () => {
  it('calculates read time for a given file size and speed', () => {
    const result = sequentialReadTimeMs(90 * 1024 * 1024 * 1024, 500);
    expect(result).toBeGreaterThan(0);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('returns Infinity when iopMBps is 0', () => {
    const result = sequentialReadTimeMs(1024, 0);
    expect(result).toBe(Infinity);
  });

  it('returns 0 for empty file', () => {
    const result = sequentialReadTimeMs(0, 500);
    expect(result).toBe(0);
  });
});

describe('indexReadTimeMs', () => {
  it('calculates SSD path with batched reads', () => {
    const result = indexReadTimeMs(100, 100 * 1024 * 1024 * 1024, 500, 0.1, false);
    expect(result).toBeGreaterThan(0);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('calculates HDD path with linear reads', () => {
    const result = indexReadTimeMs(100, 100 * 1024 * 1024 * 1024, 500, 0.1, true);
    expect(result).toBeGreaterThan(0);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('returns finite for edge case: 1 prefix', () => {
    const result = indexReadTimeMs(1, 1024, 500, 0.1, false);
    expect(Number.isFinite(result)).toBe(true);
  });
});

describe('indexSlowerThanSeq', () => {
  it('returns true when iopMBps <= 0', () => {
    expect(indexSlowerThanSeq(10, 1000, 0, 0.1, false)).toBe(true);
  });

  it('returns true when seekTimeMs <= 0', () => {
    expect(indexSlowerThanSeq(10, 1000, 500, 0, false)).toBe(true);
  });

  it('returns false for large file where index is fast', () => {
    const result = indexSlowerThanSeq(1, 100 * 1024 * 1024 * 1024, 500, 0.1, false);
    expect(result).toBe(false);
  });

  it('returns true for many prefixes on HDD', () => {
    const result = indexSlowerThanSeq(100000, 100 * 1024 * 1024 * 1024, 500, 5, true);
    expect(result).toBe(true);
  });
});

describe('estimatedBinaryTimeMs', () => {
  it('returns finite time for typical 90GB file with 1000 hashes', () => {
    const result = estimatedBinaryTimeMs(90 * 1024 * 1024 * 1024, 0.1, 1000);
    expect(result).toBeGreaterThan(0);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('returns 0 when seekTimeMs is 0', () => {
    const result = estimatedBinaryTimeMs(1000, 0, 10);
    expect(result).toBe(0);
  });

  it('handles single hash', () => {
    const result = estimatedBinaryTimeMs(1024, 0.1, 1);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('scales with hash count', () => {
    const single = estimatedBinaryTimeMs(90 * 1024 * 1024 * 1024, 0.1, 1);
    const many = estimatedBinaryTimeMs(90 * 1024 * 1024 * 1024, 0.1, 100);
    expect(many).toBeGreaterThan(single);
  });

  it('handles small file', () => {
    const result = estimatedBinaryTimeMs(1024, 0.1, 5);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('returns 0 when seekTimeMs is 0 on HDD', () => {
    const result = estimatedBinaryTimeMs(1000, 0, 10, true);
    expect(result).toBe(0);
  });

  it('HDD estimate is greater than SSD estimate for same params', () => {
    const fileSize = 90 * 1024 * 1024 * 1024;
    const ssd = estimatedBinaryTimeMs(fileSize, 8, 1000, false);
    const hdd = estimatedBinaryTimeMs(fileSize, 8, 1000, true);
    expect(hdd).toBeGreaterThan(ssd);
  });

  it('HDD estimate for 89GB file with 1000 hashes is ~506s', () => {
    const fileSize = 89 * 1024 * 1024 * 1024;
    const result = estimatedBinaryTimeMs(fileSize, 8, 1000, true);
    expect(result).toBeGreaterThan(450_000);
    expect(result).toBeLessThan(560_000);
  });

  it('returns 0 for 0 hashes on HDD', () => {
    const result = estimatedBinaryTimeMs(1024, 0.1, 0, true);
    expect(result).toBe(0);
  });
});

describe('maxBinaryHashes', () => {
  it('returns 0 when iopMBps <= 0', () => {
    expect(maxBinaryHashes(1000, 0, 0.1, 100)).toBe(0);
  });

  it('returns 0 when seekTimeMs <= 0', () => {
    expect(maxBinaryHashes(1000, 500, 0, 100)).toBe(0);
  });

  it('returns hashCount when all hashes fit within seq time', () => {
    const result = maxBinaryHashes(2 * 1024 * 1024, 150, 0.1, 1);
    expect(result).toBe(1);
  });

  it('returns a number <= hashCount', () => {
    const result = maxBinaryHashes(90 * 1024 * 1024 * 1024, 500, 0.1, 10000);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(10000);
  });

  it('HDD with small hash count returns nonzero (binary beats sequential)', () => {
    const fileSize = 89 * 1024 * 1024 * 1024;
    const result = maxBinaryHashes(fileSize, 175, 8, 100, true);
    expect(result).toBeGreaterThan(0);
  });

  it('HDD crossover is ~1600 for 89GB file', () => {
    const fileSize = 89 * 1024 * 1024 * 1024;
    const below = maxBinaryHashes(fileSize, 175, 8, 2000, true);
    const above = maxBinaryHashes(fileSize, 175, 8, 5000, true);
    expect(below).toBeGreaterThan(1000);
    expect(below).toBeLessThan(2000);
    expect(above).toBeGreaterThan(1000);
    expect(above).toBeLessThan(5000);
  });

  it('returns 0 for 0 hashes', () => {
    expect(maxBinaryHashes(1024, 100, 0.1, 0, true)).toBe(0);
  });
});

describe('evaluateReadMode', () => {
  const SSD_IOP = 600;
  const SSD_SEEK = 0.05;

  it('preCheckSkipped + few hashes → binary', () => {
    const ev = evaluateReadMode({
      fileSize: 100 * 1024 * 1024,
      iopMBps: 0,
      seekTimeMs: 0,
      isHDD: false,
      hashCount: 5,
      uniquePrefixCount: 5,
      preCheckSkipped: true,
      hasFreshIdx: false,
    });
    expect(ev.reader).toBe('binary');
    expect(ev.binTimeMs).toBeDefined();
    expect(ev.seqTimeMs).toBeLessThan(Infinity);
  });

  it('preCheckSkipped + many hashes → sequential', () => {
    const ev = evaluateReadMode({
      fileSize: 100 * 1024 * 1024,
      iopMBps: 0,
      seekTimeMs: 0,
      isHDD: false,
      hashCount: 10000,
      uniquePrefixCount: 10000,
      preCheckSkipped: true,
      hasFreshIdx: false,
    });
    expect(ev.reader).toBe('sequential');
    expect(ev.seqTimeMs).toBeLessThan(Infinity);
  });

  it('preCheckSkipped + fresh .idx + few unique prefixes → index', () => {
    const ev = evaluateReadMode({
      fileSize: 100 * 1024 * 1024,
      iopMBps: 0,
      seekTimeMs: 0,
      isHDD: false,
      hashCount: 5,
      uniquePrefixCount: 10,
      preCheckSkipped: true,
      hasFreshIdx: true,
    });
    expect(ev.reader).toBe('index');
    expect(ev.idxTimeMs).toBeDefined();
    expect(ev.seqTimeMs).toBeLessThan(Infinity);
  });

  it('preCheckSkipped + fresh .idx + many unique prefixes → binary', () => {
    const ev = evaluateReadMode({
      fileSize: 100 * 1024 * 1024,
      iopMBps: 0,
      seekTimeMs: 0,
      isHDD: false,
      hashCount: 50,
      uniquePrefixCount: 500000,
      preCheckSkipped: true,
      hasFreshIdx: true,
    });
    expect(ev.reader).toBe('binary');
    expect(ev.binTimeMs).toBeDefined();
    expect(ev.idxTimeMs).toBeDefined();
  });

  it('iopMBps=0 without preCheckSkipped → sequential (existing behavior preserved)', () => {
    const ev = evaluateReadMode({
      fileSize: 100 * 1024 * 1024,
      iopMBps: 0,
      seekTimeMs: 0,
      isHDD: false,
      hashCount: 5,
      uniquePrefixCount: 5,
      preCheckSkipped: false,
      hasFreshIdx: false,
    });
    expect(ev.reader).toBe('sequential');
    expect(ev.seqTimeMs).toBe(Infinity);
  });

  it('real SSD speeds + few hashes → binary', () => {
    const ev = evaluateReadMode({
      fileSize: 100 * 1024 * 1024,
      iopMBps: SSD_IOP,
      seekTimeMs: SSD_SEEK,
      isHDD: false,
      hashCount: 5,
      uniquePrefixCount: 5,
      preCheckSkipped: false,
      hasFreshIdx: false,
    });
    expect(ev.reader).toBe('binary');
  });

  it('real SSD speeds + many hashes → sequential', () => {
    const ev = evaluateReadMode({
      fileSize: 100 * 1024 * 1024,
      iopMBps: SSD_IOP,
      seekTimeMs: SSD_SEEK,
      isHDD: false,
      hashCount: 10000,
      uniquePrefixCount: 10000,
      preCheckSkipped: false,
      hasFreshIdx: false,
    });
    expect(ev.reader).toBe('sequential');
  });

  it('iopMBps<=0 without preCheckSkipped → sequential', () => {
    const ev = evaluateReadMode({
      fileSize: 100 * 1024 * 1024,
      iopMBps: -1,
      seekTimeMs: 0.05,
      isHDD: false,
      hashCount: 5,
      uniquePrefixCount: 5,
      preCheckSkipped: false,
      hasFreshIdx: false,
    });
    expect(ev.reader).toBe('sequential');
    expect(ev.seqTimeMs).toBe(Infinity);
  });

  it('seekTimeMs<=0 without preCheckSkipped → sequential', () => {
    const ev = evaluateReadMode({
      fileSize: 100 * 1024 * 1024,
      iopMBps: 600,
      seekTimeMs: 0,
      isHDD: false,
      hashCount: 5,
      uniquePrefixCount: 5,
      preCheckSkipped: false,
      hasFreshIdx: false,
    });
    expect(ev.reader).toBe('sequential');
    expect(ev.seqTimeMs).toBe(Infinity);
  });

  it('chooses index when hasFreshIdx and index is faster than sequential', () => {
    const ev = evaluateReadMode({
      fileSize: 90 * 1024 * 1024 * 1024,
      iopMBps: 500,
      seekTimeMs: 0.1,
      isHDD: false,
      hashCount: 100,
      uniquePrefixCount: 1,
      preCheckSkipped: false,
      hasFreshIdx: true,
    });
    expect(ev.reader).toBe('index');
    expect(ev.idxTimeMs).toBeGreaterThanOrEqual(0);
    expect(ev.seqTimeMs).toBeGreaterThan(0);
    expect(ev.binTimeMs).toBeGreaterThanOrEqual(0);
    expect(ev.binCap).toBeGreaterThanOrEqual(0);
  });

  it('chooses binary when index not viable but binary is', () => {
    const ev = evaluateReadMode({
      fileSize: 10 * 1024 * 1024 * 1024,
      iopMBps: 200,
      seekTimeMs: 1,
      isHDD: false,
      hashCount: 10,
      uniquePrefixCount: 10_000_000,
      preCheckSkipped: false,
      hasFreshIdx: true,
    });
    expect(ev.reader).toBe('binary');
    expect(ev.idxTimeMs).toBeGreaterThan(0);
    expect(ev.binTimeMs).toBeGreaterThanOrEqual(0);
    expect(ev.binCap).toBeGreaterThanOrEqual(10);
  });

  it('chooses sequential when index and binary both not viable', () => {
    const ev = evaluateReadMode({
      fileSize: 1024 * 1024 * 1024,
      iopMBps: 1000,
      seekTimeMs: 10,
      isHDD: false,
      hashCount: 5000,
      uniquePrefixCount: 6000,
      preCheckSkipped: false,
      hasFreshIdx: true,
    });
    expect(ev.reader).toBe('sequential');
    expect(ev.idxTimeMs).toBeGreaterThan(0);
    expect(ev.binCap).toBeGreaterThanOrEqual(0);
  });

  it('chooses binary when index not viable and preCheckSkipped with real iop values', () => {
    const ev = evaluateReadMode({
      fileSize: 10000,
      iopMBps: 1,
      seekTimeMs: 100,
      isHDD: false,
      hashCount: 10,
      uniquePrefixCount: 100,
      preCheckSkipped: true,
      hasFreshIdx: true,
    });
    expect(ev.reader).toBe('binary');
    expect(ev.idxTimeMs).toBeGreaterThan(0);
    expect(ev.binTimeMs).toBeGreaterThan(0);
    expect(ev.binCap).toBeGreaterThanOrEqual(10);
  });

  it('chooses binary when no fresh idx and binary is viable', () => {
    const ev = evaluateReadMode({
      fileSize: 1024 * 1024 * 1024,
      iopMBps: 100,
      seekTimeMs: 0.1,
      isHDD: false,
      hashCount: 10,
      uniquePrefixCount: 0,
      preCheckSkipped: false,
      hasFreshIdx: false,
    });
    expect(ev.reader).toBe('binary');
    expect(ev.idxTimeMs).toBeUndefined();
    expect(ev.binTimeMs).toBeGreaterThanOrEqual(0);
    expect(ev.binCap).toBeGreaterThanOrEqual(10);
  });

  it('chooses sequential when no fresh idx and binary not viable', () => {
    const ev = evaluateReadMode({
      fileSize: 1024 * 1024 * 1024,
      iopMBps: 100,
      seekTimeMs: 10,
      isHDD: true,
      hashCount: 100000,
      uniquePrefixCount: 0,
      preCheckSkipped: false,
      hasFreshIdx: false,
    });
    expect(ev.reader).toBe('sequential');
    expect(ev.idxTimeMs).toBeUndefined();
    expect(ev.binCap).toBeGreaterThanOrEqual(0);
  });

  it('chooses binary when no fresh idx and preCheckSkipped with real iop values', () => {
    const ev = evaluateReadMode({
      fileSize: 1024 * 1024 * 1024,
      iopMBps: 100,
      seekTimeMs: 0.1,
      isHDD: false,
      hashCount: 10,
      uniquePrefixCount: 0,
      preCheckSkipped: true,
      hasFreshIdx: false,
    });
    expect(ev.reader).toBe('binary');
    expect(ev.binTimeMs).toBeGreaterThan(0);
    expect(ev.binCap).toBeGreaterThanOrEqual(10);
  });

  it('returns sequential with Infinity seqTimeMs when iopMBps is 0', () => {
    const ev = evaluateReadMode({
      fileSize: 1000,
      iopMBps: 0,
      seekTimeMs: 0.1,
      isHDD: false,
      hashCount: 10,
      uniquePrefixCount: 5,
      preCheckSkipped: false,
      hasFreshIdx: true,
    });
    expect(ev.reader).toBe('sequential');
    expect(ev.seqTimeMs).toBe(Infinity);
  });

  it('returns sequential with Infinity seqTimeMs when seekTimeMs is 0', () => {
    const ev = evaluateReadMode({
      fileSize: 1000,
      iopMBps: 100,
      seekTimeMs: 0,
      isHDD: false,
      hashCount: 10,
      uniquePrefixCount: 5,
      preCheckSkipped: false,
      hasFreshIdx: true,
    });
    expect(ev.reader).toBe('sequential');
    expect(ev.seqTimeMs).toBe(Infinity);
  });

  it('HDD: chooses binary when index not viable and hash count fits', () => {
    const ev = evaluateReadMode({
      fileSize: 89 * 1024 * 1024 * 1024,
      iopMBps: 175,
      seekTimeMs: 8,
      isHDD: true,
      hashCount: 1000,
      uniquePrefixCount: 1000,
      preCheckSkipped: false,
      hasFreshIdx: false,
    });
    expect(ev.reader).toBe('binary');
    expect(ev.binCap).toBeGreaterThanOrEqual(1000);
  });

  it('HDD: chooses sequential when index not viable and hash count exceeds binary cap', () => {
    const ev = evaluateReadMode({
      fileSize: 89 * 1024 * 1024 * 1024,
      iopMBps: 175,
      seekTimeMs: 8,
      isHDD: true,
      hashCount: 10000,
      uniquePrefixCount: 10000,
      preCheckSkipped: false,
      hasFreshIdx: false,
    });
    expect(ev.reader).toBe('sequential');
    expect(ev.binCap).toBeLessThan(10000);
  });
});
