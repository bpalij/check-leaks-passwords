import path from 'path';
import fs from 'fs';

import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';

import { processSingleFile } from './processSingleFile.js';
import { sequentialReader } from './readModes/sequential.js';
import type { PasswordObject } from '../types.js';
import * as determineOptimalChunkCountModule from '../memory/determineOptimalChunkCount.js';
import * as detectSortednessModule from '../hashing/detectSortedness.js';
import { IDX_PREFIX_COUNT, IDX_HEADER_SIZE } from '../constants.js';
import { FIXTURES_DIR } from '../../tests/helpers/fixturesDir.js';
import { makeMap } from '../../tests/helpers/makeMap.js';

const fixturesDir = FIXTURES_DIR;

vi.mock('../hashing/detectSortedness.js', () => ({
  detectSortedness: vi.fn().mockResolvedValue(true),
}));

vi.mock('../memory/getAvailableMemBytes', () => ({
  getAvailableMemBytes: () => 32 * 1024 * 1024 * 1024,
}));

vi.mock('./readModes/sequential', () => ({
  sequentialReader: vi.fn(() => Promise.resolve([{ hash: 'mock-sequential', leaks: 1, passwordObjects: [] }])),
}));

vi.mock('./readModes/binarySearch', () => ({
  binarySearchReader: () => Promise.resolve([{ hash: 'mock-binary', leaks: 2, passwordObjects: [] }]),
}));

vi.mock('./readModes/indexBased', () => ({
  indexReader: () => Promise.resolve([{ hash: 'mock-index', leaks: 3, passwordObjects: [] }]),
}));

vi.mock('../constants', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../constants')>();
  return {
    ...mod,
    BINARY_JS_OVERHEAD_MS: 0.001,
    SSD_BINARY_BASE_SEEK_MS: 0.05,
  };
});

/**
 * Build arguments of the most recent `sequentialReader` invocation.
 * Mock call history is not reset between tests, so the last call is used.
 *
 * @returns Object with the `buildIndex` (arg 10) and `sorted` (arg 11) params.
 * @throws {Error} If `sequentialReader` was never called.
 */
function lastSequentialArgs(): { buildIndex?: boolean; sorted?: boolean } {
  const { calls } = vi.mocked(sequentialReader).mock;
  const last = calls.at(-1);
  if (!last) throw new Error('sequentialReader was never called');
  return { buildIndex: last[10], sorted: last[11] };
}

describe('processSingleFile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects when concurrent chunk stream errors (nonexistent path)', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    await expect(
      processSingleFile(map, '/nonexistent/path', 'ascii', undefined, 2),
    ).rejects.toThrow();
  });

  it('logs drive speed pre-check when logger is provided', async () => {
    const spy = vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount');
    spy.mockResolvedValueOnce({
      chunkCount: 1, isHDD: false, iopMBps: 750, preCheckSkipped: false, testDurationMs: 200,
    });
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const logs: string[] = [];
    await processSingleFile(
      map,
      path.join(fixturesDir, 'sample-hashes.txt'),
      'ascii',
      (msg) => { logs.push(msg); },
    );
    expect(logs.some(
      (l) => l.includes('Drive speed: ~750 MB/s (200.00ms test), using 1 chunks'),
    )).toBe(true);
  });

  it('logs CHUNK_COUNT from environment', async () => {
    process.env.CHUNK_COUNT = '3';
    try {
      const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
      const logs: string[] = [];
      await processSingleFile(
        map,
        path.join(fixturesDir, 'sample-hashes.txt'),
        'ascii',
        (msg) => { logs.push(msg); },
      );
      expect(logs.some((l) => l.includes('Using CHUNK_COUNT=3'))).toBe(true);
    } finally {
      delete process.env.CHUNK_COUNT;
    }
  });

  it('caps invalid CHUNK_COUNT to 1', async () => {
    process.env.CHUNK_COUNT = '0';
    try {
      const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
      const logs: string[] = [];
      await processSingleFile(
        map,
        path.join(fixturesDir, 'sample-hashes.txt'),
        'ascii',
        (msg) => { logs.push(msg); },
      );
      expect(logs.some((l) => l.includes('Using CHUNK_COUNT=1'))).toBe(true);
    } finally {
      delete process.env.CHUNK_COUNT;
    }
  });

  it('uses CHUNK_COUNT from environment without logger', async () => {
    process.env.CHUNK_COUNT = '3';
    try {
      const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
      const result = await processSingleFile(
        map,
        path.join(fixturesDir, 'sample-hashes.txt'),
        'ascii',
        undefined,
      );
      expect(result).toHaveLength(1);
    } finally {
      delete process.env.CHUNK_COUNT;
    }
  });
});

describe('processSingleFile mode selection', () => {
  const encoding = 'ascii';

  const fixturePath = path.resolve(FIXTURES_DIR, 'binary-sorted-hashes.txt');

  function makeSingleHashMap(): Map<string, PasswordObject[]> {
    const m = new Map<string, PasswordObject[]>();
    m.set('A000000000000000000000000000000000000000', [{ login_password: 'pass' }]);
    return m;
  }

  function makeBigMap(): Map<string, PasswordObject[]> {
    const m = new Map<string, PasswordObject[]>();
    for (let i = 0; i < 10000; i += 1) {
      m.set(`${i.toString(16).toUpperCase().padStart(40, '0')}`, [{ login_password: 'pass' }]);
    }
    return m;
  }

  function makeFakeIdxBuffer(): Buffer {
    const headerBuf = Buffer.alloc(IDX_HEADER_SIZE);
    headerBuf[0] = 0x01;
    const idxBuf = Buffer.alloc((IDX_PREFIX_COUNT + 1) * 8);
    return Buffer.concat([headerBuf, idxBuf]);
  }

  beforeEach(() => {
    vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(true);
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
      chunkCount: 1,
      seekTimeMs: 0.1,
      iopMBps: 500,
      isHDD: false,
      preCheckSkipped: false,
      testDurationMs: 128,
    } as never);
    vi.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined as never);
    vi.spyOn(fs.promises, 'readFile').mockImplementation(async (p) => {
      if (typeof p === 'string' && p.endsWith('.idx')) return makeFakeIdxBuffer();
      return Buffer.alloc(0);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockStatFresh() {
    return vi.spyOn(fs.promises, 'stat').mockImplementation(async (p) => {
      if (typeof p === 'string' && p.endsWith('.idx')) {
        return {
          size: 8388617,
          mtimeMs: Date.now() + 60000,
          isFile: () => true,
        } as unknown as fs.Stats;
      }
      return {
        size: 90 * 1024 * 1024 * 1024,
        mtimeMs: Date.now(),
        isFile: () => true,
      } as unknown as fs.Stats;
    });
  }

  function mockStatStale() {
    return vi.spyOn(fs.promises, 'stat').mockImplementation(async (p) => {
      if (typeof p === 'string' && p.endsWith('.idx')) {
        return {
          size: 8388617,
          mtimeMs: Date.now() - 60000,
          isFile: () => true,
        } as unknown as fs.Stats;
      }
      return {
        size: 90 * 1024 * 1024 * 1024,
        mtimeMs: Date.now(),
        isFile: () => true,
      } as unknown as fs.Stats;
    });
  }

  function mockStatNoIdx() {
    return vi.spyOn(fs.promises, 'stat').mockImplementation(async (p) => {
      if (typeof p === 'string' && p.endsWith('.idx')) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      return {
        size: 90 * 1024 * 1024 * 1024,
        mtimeMs: Date.now(),
        isFile: () => true,
      } as unknown as fs.Stats;
    });
  }

  it('sequential-noindex mode', async () => {
    mockStatFresh();
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'sequential',
    );
    expect(r[0].hash).toBe('mock-sequential');
  });

  it('binary-noindex mode with sorted file', async () => {
    mockStatNoIdx();
    const logs: string[] = [];
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      (m) => logs.push(m),
      undefined,
      undefined,
      'binary',
    );
    expect(r[0].hash).toBe('mock-binary');
    expect(logs.some((l) => l.includes('Read modes:'))).toBe(true);
  });

  it('index mode with fresh .idx', async () => {
    mockStatFresh();
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'index',
      true,
    );
    expect(r[0].hash).toBe('mock-index');
  });

  it('index mode without .idx — sequential bootstrap builds the index', async () => {
    mockStatNoIdx();
    const logs: string[] = [];
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      (m) => logs.push(m),
      undefined,
      undefined,
      'index',
      true,
    );
    expect(r[0].hash).toBe('mock-sequential');
    expect(lastSequentialArgs()).toEqual({ buildIndex: true, sorted: true });
    expect(logs.some((l) => l.includes('No fresh .idx found'))).toBe(true);
    // The fallback must run before read-mode evaluation, so no estimate is logged
    expect(logs.some((l) => l.includes('Read modes:'))).toBe(false);
  });

  it('auto-index with fresh .idx', async () => {
    mockStatFresh();
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'auto',
      true,
    );
    expect(r[0].hash).toBe('mock-index');
  });

  it('auto-noindex with fresh .idx', async () => {
    mockStatFresh();
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'auto',
    );
    expect(r[0].hash).toBe('mock-index');
  });

  it('binary-noindex with unsorted file', async () => {
    mockStatNoIdx();
    vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(false);
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'binary',
    );
    expect(r[0].hash).toBe('mock-sequential');
  });

  it('binary-noindex with HDD — chosen when hash count fits within budget', async () => {
    mockStatNoIdx();
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
      chunkCount: 1,
      seekTimeMs: 0.1,
      iopMBps: 500,
      isHDD: true,
      preCheckSkipped: false,
      testDurationMs: 128,
    } as never);
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'binary',
    );
    expect(r[0].hash).toBe('mock-binary');
  });

  it('index with stale .idx — sequential bootstrap rebuilds the index', async () => {
    mockStatStale();
    const logs: string[] = [];
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      (m) => logs.push(m),
      undefined,
      undefined,
      'index',
      true,
    );
    expect(r[0].hash).toBe('mock-sequential');
    expect(lastSequentialArgs()).toEqual({ buildIndex: true, sorted: true });
    expect(logs.some((l) => l.includes('No fresh .idx found'))).toBe(true);
  });

  it(
    'index mode with fresh .idx and preCheckSkipped'
    + ' (iopMBps=0) — SSD defaults enable index',
    async () => {
      mockStatFresh();
      vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
        chunkCount: 1,
        seekTimeMs: 0,
        iopMBps: 0,
        isHDD: false,
        preCheckSkipped: true,
        testDurationMs: 0,
      } as never);
      const r = await processSingleFile(
        makeSingleHashMap(),
        fixturePath,
        encoding,
        undefined,
        undefined,
        undefined,
        'index',
        true,
      );
      expect(r[0].hash).toBe('mock-sequential');
    },
  );

  it('index with unsorted file — sequential without index build', async () => {
    mockStatNoIdx();
    vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(false);
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'index',
      true,
    );
    expect(r[0].hash).toBe('mock-sequential');
    expect(lastSequentialArgs()).toEqual({ buildIndex: false, sorted: false });
  });

  it('auto-index with unsorted file', async () => {
    mockStatNoIdx();
    vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(false);
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'auto',
      true,
    );
    expect(r[0].hash).toBe('mock-sequential');
  });

  it('auto-noindex without .idx few hashes binary', async () => {
    mockStatNoIdx();
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'auto',
    );
    expect(r[0].hash).toBe('mock-binary');
  });

  it('auto-noindex without .idx preCheckSkipped — binary chosen with real iop', async () => {
    mockStatNoIdx();
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
      chunkCount: 1,
      seekTimeMs: 0.1,
      iopMBps: 500,
      isHDD: false,
      preCheckSkipped: true,
      testDurationMs: 128,
    } as never);
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'auto',
    );
    expect(r[0].hash).toBe('mock-sequential');
  });

  it('auto-noindex without .idx HDD — binary chosen when hashes fit', async () => {
    mockStatNoIdx();
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
      chunkCount: 1,
      seekTimeMs: 0.1,
      iopMBps: 500,
      isHDD: true,
      preCheckSkipped: false,
      testDurationMs: 128,
    } as never);
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'auto',
    );
    expect(r[0].hash).toBe('mock-binary');
  });

  it('auto-noindex HDD with logger — logs HDD detected', async () => {
    mockStatNoIdx();
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
      chunkCount: 1,
      seekTimeMs: 0.1,
      iopMBps: 500,
      isHDD: true,
      preCheckSkipped: false,
      testDurationMs: 128,
    } as never);
    const logs: string[] = [];
    const savedChunkCount = process.env.CHUNK_COUNT;
    try {
      delete process.env.CHUNK_COUNT;
      await processSingleFile(
        makeSingleHashMap(),
        fixturePath,
        encoding,
        (m) => logs.push(m),
        undefined,
        undefined,
        'auto',
      );
      expect(logs.some((l) => l.includes('HDD detected, using 1 chunk'))).toBe(true);
    } finally {
      if (savedChunkCount === undefined) delete process.env.CHUNK_COUNT;
      else process.env.CHUNK_COUNT = savedChunkCount;
    }
  });

  it('auto-index without .idx few hashes binary', async () => {
    mockStatNoIdx();
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'auto',
      true,
    );
    expect(r[0].hash).toBe('mock-binary');
  });

  it('auto-index without .idx preCheckSkipped — binary chosen with real iop', async () => {
    mockStatNoIdx();
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
      chunkCount: 1,
      seekTimeMs: 0.1,
      iopMBps: 500,
      isHDD: false,
      preCheckSkipped: true,
      testDurationMs: 128,
    } as never);
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'auto',
      true,
    );
    expect(r[0].hash).toBe('mock-sequential');
  });

  it('auto-index without .idx HDD — binary chosen when hashes fit', async () => {
    mockStatNoIdx();
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
      chunkCount: 1,
      seekTimeMs: 0.1,
      iopMBps: 500,
      isHDD: true,
      preCheckSkipped: false,
      testDurationMs: 128,
    } as never);
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'auto',
      true,
    );
    expect(r[0].hash).toBe('mock-binary');
  });

  it('sequential-index mode with sorted file', async () => {
    mockStatFresh();
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'sequential',
      true,
    );
    expect(r[0].hash).toBe('mock-sequential');
  });

  it('sequential mode with unsorted file — runs sequential without building index', async () => {
    mockStatNoIdx();
    vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(false);
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'sequential',
      true,
    );
    expect(r[0].hash).toBe('mock-sequential');
    expect(lastSequentialArgs()).toEqual({ buildIndex: false, sorted: false });
  });

  it('binary-index mode with sorted file — binary chosen', async () => {
    mockStatNoIdx();
    const logs: string[] = [];
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      (m) => logs.push(m),
      undefined,
      undefined,
      'binary',
      true,
    );
    expect(r[0].hash).toBe('mock-binary');
    expect(logs.some((l) => l.includes('Read modes:'))).toBe(true);
  });

  it('binary-index with unsorted file — falls back to sequential', async () => {
    mockStatNoIdx();
    vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(false);
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'binary',
      true,
    );
    expect(r[0].hash).toBe('mock-sequential');
  });

  it(
    'binary-index sorted, hash count exceeds binary cap'
    + ' → sequential fallback',
    async () => {
      vi.spyOn(fs.promises, 'stat').mockImplementation(async (p) => {
        if (typeof p === 'string' && p.endsWith('.idx')) {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        }
        return {
          size: 10_000_000,
          mtimeMs: Date.now(),
          isFile: () => true,
        } as unknown as fs.Stats;
      });
      vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
        chunkCount: 1,
        seekTimeMs: 10,
        iopMBps: 100,
        isHDD: false,
        preCheckSkipped: false,
        testDurationMs: 128,
      } as never);
      const logs: string[] = [];
      const r = await processSingleFile(
        makeBigMap(),
        fixturePath,
        encoding,
        (m) => logs.push(m),
        undefined,
        undefined,
        'binary',
        true,
      );
      expect(r[0].hash).toBe('mock-sequential');
      expect(logs.some((l) => l.includes('Read modes:'))).toBe(true);
    },
  );

  it('unknown mode throws', async () => {
    mockStatNoIdx();
    await expect(
      processSingleFile(
        makeSingleHashMap(),
        fixturePath,
        encoding,
        undefined,
        undefined,
        undefined,
        'unknown' as never,
      ),
    ).rejects.toThrow("Unknown singleFileReadMode: 'unknown'");
  });

  it('chunkCountOverride forces sequential', async () => {
    mockStatFresh();
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      undefined,
      1,
      undefined,
      'binary',
    );
    expect(r[0].hash).toBe('mock-sequential');
  });

  it('chunkCountOverride with auto mode and buildIndex=false — no index build', async () => {
    mockStatFresh();
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      undefined,
      1,
      undefined,
      'auto',
    );
    expect(r[0].hash).toBe('mock-sequential');
    expect(lastSequentialArgs().buildIndex).toBe(false);
  });

  it('chunkCountOverride with auto mode and buildIndex=true — index build', async () => {
    mockStatFresh();
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      undefined,
      1,
      undefined,
      'auto',
      true,
    );
    expect(r[0].hash).toBe('mock-sequential');
    expect(lastSequentialArgs()).toEqual({ buildIndex: true, sorted: true });
  });

  it('chunkCountOverride with unsorted file — no index build', async () => {
    mockStatFresh();
    vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(false);
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      undefined,
      1,
      undefined,
      'auto',
      true,
    );
    expect(r[0].hash).toBe('mock-sequential');
    expect(lastSequentialArgs()).toEqual({ buildIndex: false, sorted: false });
  });

  it('preCheckSkipped with sorted file and buildIndex=true — index build', async () => {
    mockStatNoIdx();
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
      chunkCount: 1,
      seekTimeMs: 0,
      iopMBps: 500,
      isHDD: false,
      preCheckSkipped: true,
      testDurationMs: 0,
    } as never);
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'binary',
      true,
    );
    expect(r[0].hash).toBe('mock-sequential');
    expect(lastSequentialArgs()).toEqual({ buildIndex: true, sorted: true });
  });

  it('preCheckSkipped with unsorted file and buildIndex=true — no index build', async () => {
    mockStatNoIdx();
    vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(false);
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
      chunkCount: 1,
      seekTimeMs: 0,
      iopMBps: 500,
      isHDD: false,
      preCheckSkipped: true,
      testDurationMs: 0,
    } as never);
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'binary',
      true,
    );
    expect(r[0].hash).toBe('mock-sequential');
    expect(lastSequentialArgs()).toEqual({ buildIndex: false, sorted: false });
  });

  it('chunkCountOverride with sequential mode and buildIndex', async () => {
    mockStatFresh();
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      undefined,
      1,
      undefined,
      'sequential',
      true,
    );
    expect(r[0].hash).toBe('mock-sequential');
  });

  it(
    'binary-noindex mode sorted, hash count exceeds'
    + ' binary cap → sequential fallback',
    async () => {
      vi.spyOn(fs.promises, 'stat').mockImplementation(async (p) => {
        if (typeof p === 'string' && p.endsWith('.idx')) {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        }
        return {
          size: 10_000_000,
          mtimeMs: Date.now(),
          isFile: () => true,
        } as unknown as fs.Stats;
      });
      vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
        chunkCount: 1,
        seekTimeMs: 10,
        iopMBps: 100,
        isHDD: false,
        preCheckSkipped: false,
        testDurationMs: 128,
      } as never);
      const logs: string[] = [];
      const r = await processSingleFile(
        makeBigMap(),
        fixturePath,
        encoding,
        (m) => logs.push(m),
        undefined,
        undefined,
        'binary',
      );
      expect(r[0].hash).toBe('mock-sequential');
      expect(logs.some((l) => l.includes('Read modes:'))).toBe(true);
    },
  );

  it('logger covers decision branches', async () => {
    mockStatNoIdx();
    const logs: string[] = [];
    await processSingleFile(
      makeBigMap(),
      fixturePath,
      encoding,
      (m) => logs.push(m),
      undefined,
      undefined,
      'auto',
      true,
    );
    expect(logs.length).toBeGreaterThan(0);
  });

  describe('READ_MODE_FORCED env var', () => {
    const savedEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...savedEnv };
    });

    it('invalid value throws', async () => {
      process.env.READ_MODE_FORCED = 'bogus';
      mockStatNoIdx();
      await expect(
        processSingleFile(
          makeSingleHashMap(),
          fixturePath,
          encoding,
          undefined,
          undefined,
          undefined,
          'auto',
        ),
      ).rejects.toThrow('READ_MODE_FORCED must be one of:');
    });

    it('binary with sorted file → binarySearchReader', async () => {
      process.env.READ_MODE_FORCED = 'binary';
      mockStatNoIdx();
      const r = await processSingleFile(
        makeSingleHashMap(),
        fixturePath,
        encoding,
        undefined,
        undefined,
        undefined,
        'auto',
      );
      expect(r[0].hash).toBe('mock-binary');
    });

    it('binary with unsorted file → throws', async () => {
      process.env.READ_MODE_FORCED = 'binary';
      mockStatNoIdx();
      vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(false);
      await expect(
        processSingleFile(
          makeSingleHashMap(),
          fixturePath,
          encoding,
          undefined,
          undefined,
          undefined,
          'auto',
        ),
      ).rejects.toThrow('READ_MODE_FORCED=binary requires a sorted file');
    });

    it('index with sorted file and fresh .idx → indexReader', async () => {
      process.env.READ_MODE_FORCED = 'index';
      mockStatFresh();
      const r = await processSingleFile(
        makeSingleHashMap(),
        fixturePath,
        encoding,
        undefined,
        undefined,
        undefined,
        'auto',
      );
      expect(r[0].hash).toBe('mock-index');
    });

    it('sequential-noindex → sequentialReader', async () => {
      process.env.READ_MODE_FORCED = 'sequential-noindex';
      mockStatNoIdx();
      const r = await processSingleFile(
        makeSingleHashMap(),
        fixturePath,
        encoding,
        undefined,
        undefined,
        undefined,
        'auto',
      );
      expect(r[0].hash).toBe('mock-sequential');
    });

    it('sequential-index with sorted file → sequentialReader builds index despite BUILD_INDEX=false', async () => {
      process.env.READ_MODE_FORCED = 'sequential-index';
      mockStatNoIdx();
      // preCheckSkipped=false + iopMBps=0 → evaluateReadMode returns seqTimeMs=Infinity
      // (readModeEvaluator.ts:225), exercising the fmt() non-finite fallback.
      vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
        chunkCount: 1,
        seekTimeMs: 0.1,
        iopMBps: 0,
        isHDD: false,
        preCheckSkipped: false,
        testDurationMs: 128,
      } as never);
      const logs: string[] = [];
      const r = await processSingleFile(
        makeSingleHashMap(),
        fixturePath,
        encoding,
        (m) => logs.push(m),
        undefined,
        undefined,
        'auto',
        false,
      );
      expect(r[0].hash).toBe('mock-sequential');
      expect(lastSequentialArgs()).toEqual({ buildIndex: true, sorted: true });
      expect(logs.some((l) => l.includes('Read mode overridden by READ_MODE_FORCED env: sequential-index'))).toBe(true);
      expect(logs.some((l) => l.includes('Read modes: sequential'))).toBe(true);
    });

    it('sequential-index with unsorted file → throws', async () => {
      process.env.READ_MODE_FORCED = 'sequential-index';
      mockStatNoIdx();
      vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(false);
      await expect(
        processSingleFile(
          makeSingleHashMap(),
          fixturePath,
          encoding,
          undefined,
          undefined,
          undefined,
          'auto',
        ),
      ).rejects.toThrow('READ_MODE_FORCED=sequential-index requires a sorted file');
    });

    it('sequential-index with small file (preCheckSkipped) → env override wins over fast path', async () => {
      process.env.READ_MODE_FORCED = 'sequential-index';
      mockStatNoIdx();
      vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
        chunkCount: 1,
        seekTimeMs: 0.1,
        iopMBps: 500,
        isHDD: false,
        preCheckSkipped: true,
        testDurationMs: 128,
      } as never);
      const logs: string[] = [];
      const r = await processSingleFile(
        makeSingleHashMap(),
        fixturePath,
        encoding,
        (m) => logs.push(m),
        undefined,
        undefined,
        'auto',
      );
      expect(r[0].hash).toBe('mock-sequential');
      expect(lastSequentialArgs()).toEqual({ buildIndex: true, sorted: true });
      expect(logs.some((l) => l.includes('Read mode overridden by READ_MODE_FORCED env: sequential-index'))).toBe(true);
    });

    it('index with stale .idx → throws', async () => {
      process.env.READ_MODE_FORCED = 'index';
      mockStatStale();
      await expect(
        processSingleFile(
          makeSingleHashMap(),
          fixturePath,
          encoding,
          undefined,
          undefined,
          undefined,
          'auto',
        ),
      ).rejects.toThrow('READ_MODE_FORCED=index requires a fresh .idx file');
    });

    it('logs override message when READ_MODE_FORCED is set with logger', async () => {
      process.env.READ_MODE_FORCED = 'sequential-noindex';
      mockStatNoIdx();
      const logs: string[] = [];
      const r = await processSingleFile(
        makeSingleHashMap(),
        fixturePath,
        encoding,
        (m) => logs.push(m),
        undefined,
        undefined,
        'auto',
      );
      expect(r[0].hash).toBe('mock-sequential');
      expect(logs.some((l) => l.includes('Read mode overridden by READ_MODE_FORCED env: sequential-noindex'))).toBe(true);
    });
  });

  it('index mode with fresh .idx logs binary time when computed', async () => {
    mockStatFresh();
    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      logger,
      undefined,
      undefined,
      'index',
      true,
    );
    expect(r[0].hash).toBe('mock-index');
    expect(logs.some((l) => l.includes('Read modes:'))).toBe(true);
  });

  it('auto mode with fresh .idx logs read mode breakdown', async () => {
    mockStatFresh();
    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      logger,
    );
    expect(r.length).toBe(1);
    expect(logs.some((l) => l.includes('Fresh .idx found'))).toBe(true);
    expect(logs.some((l) => l.includes('Read modes:'))).toBe(true);
  });

  it('auto mode without .idx and zero iop skips read mode log', async () => {
    mockStatNoIdx();
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
      chunkCount: 1,
      seekTimeMs: 0,
      iopMBps: 0,
      isHDD: false,
      preCheckSkipped: false,
      testDurationMs: 0,
    } as never);
    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };
    const r = await processSingleFile(
      makeSingleHashMap(),
      fixturePath,
      encoding,
      logger,
    );
    expect(r[0].hash).toBe('mock-sequential');
    expect(logs.some((l) => l.includes('Read modes:'))).toBe(false);
  });
});

describe('processSingleFile auto-index paths', () => {
  const encoding = 'ascii';
  const fixturePath = '/fake/file.txt';

  function makeFakeIdxBuffer(): Buffer {
    const headerBuf = Buffer.alloc(IDX_HEADER_SIZE);
    headerBuf[0] = 0x01;
    const idxBuf = Buffer.alloc((IDX_PREFIX_COUNT + 1) * 8);
    return Buffer.concat([headerBuf, idxBuf]);
  }

  function makeDiverseMap(count: number): Map<string, PasswordObject[]> {
    const m = new Map<string, PasswordObject[]>();
    for (let i = 0; i < count; i += 1) {
      const prefix = i.toString(16).toUpperCase().padStart(5, '0');
      const suffix = '0'.repeat(35);
      m.set(`${prefix}${suffix}`, [{ login_password: 'pass' }]);
    }
    return m;
  }

  function makeSmallMap(): Map<string, PasswordObject[]> {
    const m = new Map<string, PasswordObject[]>();
    m.set('A000000000000000000000000000000000000000', [{ login_password: 'pass' }]);
    return m;
  }

  beforeEach(() => {
    vi.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined as never);
    vi.spyOn(fs.promises, 'readFile').mockImplementation(async (p) => {
      if (typeof p === 'string' && p.endsWith('.idx')) return makeFakeIdxBuffer();
      return Buffer.alloc(0);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockStatFresh() {
    return vi.spyOn(fs.promises, 'stat').mockImplementation(async (p) => {
      if (typeof p === 'string' && p.endsWith('.idx')) {
        return {
          size: IDX_HEADER_SIZE + (IDX_PREFIX_COUNT + 1) * 8,
          mtimeMs: Date.now() + 60000,
          isFile: () => true,
        } as unknown as fs.Stats;
      }
      return { size: 10_000_000, mtimeMs: Date.now(), isFile: () => true } as unknown as fs.Stats;
    });
  }

  function mockStatNoIdx() {
    return vi.spyOn(fs.promises, 'stat').mockImplementation(async (p) => {
      if (typeof p === 'string' && p.endsWith('.idx')) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      return { size: 10_000_000, mtimeMs: Date.now(), isFile: () => true } as unknown as fs.Stats;
    });
  }

  it(
    'index mode with unsorted file returns early'
    + ' via sortedness check (line 271-273)',
    async () => {
      mockStatNoIdx();
      vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(false);
      vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
        chunkCount: 1,
        seekTimeMs: 10,
        iopMBps: 100,
        isHDD: false,
        preCheckSkipped: false,
        testDurationMs: 128,
      } as never);

      const r = await processSingleFile(
        makeSmallMap(),
        fixturePath,
        encoding,
        undefined,
        undefined,
        undefined,
        'index',
        true,
      );
      expect(r[0].hash).toBe('mock-sequential');
    },
  );

  it('index mode with fresh .idx, index not beneficial, too many hashes for binary', async () => {
    mockStatFresh();
    vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(true);
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
      chunkCount: 1,
      seekTimeMs: 10,
      iopMBps: 100,
      isHDD: false,
      preCheckSkipped: false,
      testDurationMs: 128,
    } as never);

    const bigMap = makeDiverseMap(10000);
    const r = await processSingleFile(
      bigMap,
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'index',
      true,
    );
    expect(r[0].hash).toBe('mock-sequential');
  });

  it('index mode with fresh .idx, index not beneficial, binary overestimated on HDD', async () => {
    vi.spyOn(fs.promises, 'stat').mockImplementation(async (p) => {
      if (typeof p === 'string' && p.endsWith('.idx')) {
        return {
          size: IDX_HEADER_SIZE + (IDX_PREFIX_COUNT + 1) * 8,
          mtimeMs: Date.now() + 60000,
          isFile: () => true,
        } as unknown as fs.Stats;
      }
      return { size: 10000, mtimeMs: Date.now(), isFile: () => true } as unknown as fs.Stats;
    });
    vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(true);
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
      chunkCount: 1,
      seekTimeMs: 0.06,
      iopMBps: 1,
      isHDD: true,
      preCheckSkipped: false,
      testDurationMs: 128,
    } as never);

    const diverseMap = makeDiverseMap(200);
    const r = await processSingleFile(
      diverseMap,
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'index',
      true,
    );
    expect(r[0].hash).toBe('mock-sequential');
  });

  it('index mode with fresh .idx, index not beneficial, preCheckSkipped skips binary', async () => {
    mockStatFresh();
    vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(true);
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
      chunkCount: 1,
      seekTimeMs: 10,
      iopMBps: 100,
      isHDD: false,
      preCheckSkipped: true,
      testDurationMs: 128,
    } as never);

    const bigMap = makeDiverseMap(10000);
    const r = await processSingleFile(
      bigMap,
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'index',
      true,
    );
    expect(r[0].hash).toBe('mock-sequential');
  });

  it(
    'auto-index with fresh .idx, index not beneficial,'
    + ' too many hashes for binary (line 397)',
    async () => {
      mockStatFresh();
      vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(true);
      vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
        chunkCount: 1,
        seekTimeMs: 10,
        iopMBps: 100,
        isHDD: false,
        preCheckSkipped: false,
        testDurationMs: 128,
      } as never);

      const bigMap = makeDiverseMap(10000);
      const r = await processSingleFile(
        bigMap,
        fixturePath,
        encoding,
        undefined,
        undefined,
        undefined,
        'auto',
        true,
      );
      expect(r[0].hash).toBe('mock-sequential');
    },
  );

  it('auto-index with fresh .idx, index not beneficial, preCheckSkipped (line 397)', async () => {
    mockStatFresh();
    vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(true);
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
      chunkCount: 1,
      seekTimeMs: 10,
      iopMBps: 100,
      isHDD: false,
      preCheckSkipped: true,
      testDurationMs: 128,
    } as never);

    const bigMap = makeDiverseMap(10000);
    const r = await processSingleFile(
      bigMap,
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'auto',
      true,
    );
    expect(r[0].hash).toBe('mock-sequential');
  });

  it('auto-index without .idx, too many hashes for binary (line 416)', async () => {
    mockStatNoIdx();
    vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(true);
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
      chunkCount: 1,
      seekTimeMs: 1,
      iopMBps: 100,
      isHDD: false,
      preCheckSkipped: false,
      testDurationMs: 128,
    } as never);

    const bigMap = makeDiverseMap(10000);
    const r = await processSingleFile(
      bigMap,
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'auto',
      true,
    );
    expect(r[0].hash).toBe('mock-sequential');
  });

  it('auto-noindex without .idx, too many hashes for binary (line 416)', async () => {
    mockStatNoIdx();
    vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(true);
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
      chunkCount: 1,
      seekTimeMs: 1,
      iopMBps: 100,
      isHDD: false,
      preCheckSkipped: false,
      testDurationMs: 128,
    } as never);

    const bigMap = makeDiverseMap(10000);
    const r = await processSingleFile(
      bigMap,
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'auto',
    );
    expect(r[0].hash).toBe('mock-sequential');
  });

  it('auto-index without .idx, binary search beneficial (lines 404-414)', async () => {
    mockStatNoIdx();
    vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(true);
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
      chunkCount: 1,
      seekTimeMs: 0.01,
      iopMBps: 100,
      isHDD: false,
      preCheckSkipped: false,
      testDurationMs: 128,
    } as never);

    const smallMap = makeSmallMap();
    const r = await processSingleFile(
      smallMap,
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'auto',
      true,
    );
    expect(r[0].hash).toBe('mock-binary');
  });

  it('auto-noindex without .idx, binary search beneficial (lines 404-414)', async () => {
    mockStatNoIdx();
    vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(true);
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
      chunkCount: 1,
      seekTimeMs: 0.01,
      iopMBps: 100,
      isHDD: false,
      preCheckSkipped: false,
      testDurationMs: 128,
    } as never);

    const smallMap = makeSmallMap();
    const r = await processSingleFile(
      smallMap,
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'auto',
    );
    expect(r[0].hash).toBe('mock-binary');
  });

  it(
    'auto-index with fresh .idx, index not beneficial,'
    + ' binary overestimated on HDD (line 386)',
    async () => {
      vi.spyOn(fs.promises, 'stat').mockImplementation(async (p) => {
        if (typeof p === 'string' && p.endsWith('.idx')) {
          return {
            size: IDX_HEADER_SIZE + (IDX_PREFIX_COUNT + 1) * 8,
            mtimeMs: Date.now() + 60000,
            isFile: () => true,
          } as unknown as fs.Stats;
        }
        return {
          size: 10000, mtimeMs: Date.now(), isFile: () => true,
        } as unknown as fs.Stats;
      });
      vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(true);
      vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
        chunkCount: 1,
        seekTimeMs: 0.06,
        iopMBps: 1,
        isHDD: true,
        preCheckSkipped: false,
        testDurationMs: 128,
      } as never);

      const diverseMap = makeDiverseMap(200);
      const r = await processSingleFile(
        diverseMap,
        fixturePath,
        encoding,
        undefined,
        undefined,
        undefined,
        'auto',
        true,
      );
      expect(r[0].hash).toBe('mock-sequential');
    },
  );

  it('auto-index without .idx, HDD + small hash count → binary chosen', async () => {
    vi.spyOn(fs.promises, 'stat').mockImplementation(async (p) => {
      if (typeof p === 'string' && p.endsWith('.idx')) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      return {
        size: 89 * 1024 * 1024 * 1024,
        mtimeMs: Date.now(),
        isFile: () => true,
      } as unknown as fs.Stats;
    });
    vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(true);
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
      chunkCount: 1,
      seekTimeMs: 8,
      iopMBps: 175,
      isHDD: true,
      preCheckSkipped: false,
      testDurationMs: 128,
    } as never);

    const smallMap = makeSmallMap();
    const r = await processSingleFile(
      smallMap,
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'auto',
      true,
    );
    expect(r[0].hash).toBe('mock-binary');
  });

  it('auto-index without .idx, HDD + large hash count → sequential chosen', async () => {
    vi.spyOn(fs.promises, 'stat').mockImplementation(async (p) => {
      if (typeof p === 'string' && p.endsWith('.idx')) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      return {
        size: 89 * 1024 * 1024 * 1024,
        mtimeMs: Date.now(),
        isFile: () => true,
      } as unknown as fs.Stats;
    });
    vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(true);
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
      chunkCount: 1,
      seekTimeMs: 8,
      iopMBps: 175,
      isHDD: true,
      preCheckSkipped: false,
      testDurationMs: 128,
    } as never);

    const bigMap = makeDiverseMap(10000);
    const r = await processSingleFile(
      bigMap,
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'auto',
      true,
    );
    expect(r[0].hash).toBe('mock-sequential');
  });

  it('auto-index with fresh idx, preCheckSkipped, index beats sequential (line 169)', async () => {
    vi.spyOn(fs.promises, 'stat').mockImplementation(async (p) => {
      if (typeof p === 'string' && p.endsWith('.idx')) {
        return {
          size: IDX_HEADER_SIZE + (IDX_PREFIX_COUNT + 1) * 8,
          mtimeMs: Date.now() + 60000,
          isFile: () => true,
        } as unknown as fs.Stats;
      }
      return {
        size: 1_000_000_000,
        mtimeMs: Date.now(),
        isFile: () => true,
      } as unknown as fs.Stats;
    });
    vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(true);
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
      chunkCount: 1,
      seekTimeMs: 0.001,
      iopMBps: 500,
      isHDD: false,
      preCheckSkipped: true,
      testDurationMs: 128,
    } as never);

    const r = await processSingleFile(
      makeSmallMap(),
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'auto',
      true,
    );
    expect(r[0].hash).toBe('mock-sequential');
  });

  it(
    'index mode with buildIndex=false logs warning'
    + ' and falls through to auto-detection (line 464)',
    async () => {
      mockStatNoIdx();
      vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(true);
      vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
        chunkCount: 1,
        seekTimeMs: 0.01,
        iopMBps: 500,
        isHDD: false,
        preCheckSkipped: false,
        testDurationMs: 128,
      } as never);

      const logs: string[] = [];
      const r = await processSingleFile(
        makeSmallMap(),
        fixturePath,
        encoding,
        (m) => logs.push(m),
        undefined,
        undefined,
        'index',
        false,
      );
      expect(logs.some((l) => l.includes("index' mode with buildIndex=false"))).toBe(true);
      expect(r[0].hash).toBe('mock-binary');
    },
  );

  it('index mode with fresh .idx, evaluator chooses binary over index (line 502)', async () => {
    vi.spyOn(fs.promises, 'stat').mockImplementation(async (p) => {
      if (typeof p === 'string' && p.endsWith('.idx')) {
        return {
          size: IDX_HEADER_SIZE + (IDX_PREFIX_COUNT + 1) * 8,
          mtimeMs: Date.now() + 60000,
          isFile: () => true,
        } as unknown as fs.Stats;
      }
      return {
        size: 2_000_000,
        mtimeMs: Date.now(),
        isFile: () => true,
      } as unknown as fs.Stats;
    });
    vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(true);
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
      chunkCount: 1,
      seekTimeMs: 10,
      iopMBps: 100,
      isHDD: false,
      preCheckSkipped: false,
      testDurationMs: 128,
    } as never);

    const smallDiverseMap = makeDiverseMap(34);
    const r = await processSingleFile(
      smallDiverseMap,
      fixturePath,
      encoding,
      undefined,
      undefined,
      undefined,
      'index',
      true,
    );
    expect(r[0].hash).toBe('mock-binary');
  });

  it('CHUNK_COUNT env var > 1 with HDD → respected, not overridden', async () => {
    process.env.CHUNK_COUNT = '4';
    vi.spyOn(fs.promises, 'stat').mockImplementation(async (p) => {
      if (typeof p === 'string' && p.endsWith('.idx')) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      return { size: 10000, mtimeMs: Date.now(), isFile: () => true } as unknown as fs.Stats;
    });
    vi.spyOn(detectSortednessModule, 'detectSortedness').mockResolvedValue(true);
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount').mockResolvedValue({
      chunkCount: 1,
      seekTimeMs: 0.1,
      iopMBps: 500,
      isHDD: true,
      preCheckSkipped: false,
      testDurationMs: 128,
    } as never);

    const logs: string[] = [];
    const r = await processSingleFile(
      makeSmallMap(),
      fixturePath,
      encoding,
      (m) => logs.push(m),
      undefined,
      undefined,
      'auto',
    );
    expect(r[0].hash).toBe('mock-sequential');
    expect(logs.some((l) => l.includes('Using CHUNK_COUNT=4'))).toBe(true);
    expect(logs.some((l) => l.includes('HDD detected'))).toBe(false);
    delete process.env.CHUNK_COUNT;
  });
});
