import path from 'path';
import fs from 'fs';

import { vi } from 'vitest';

import { processSplitDirectory } from './processSplitDirectory.js';
import type { PasswordObject, HashCandidate } from '../types.js';
import { groupHashesByPrefix } from '../hashing/groupByPrefix.js';
import { FIXTURES_DIR } from '../../tests/helpers/fixturesDir.js';
import { makeMap } from '../../tests/helpers/makeMap.js';

const mockMeasureSpeed = vi.hoisted(() => vi.fn(async () => ({ iopMBps: 0, isHDD: false })));
vi.mock('../memory/detectHDD.js', () => ({
  measureSequentialSpeedFromDir: (...args: unknown[]) => mockMeasureSpeed(...args),
}));

vi.mock('../hashing/groupByPrefix.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../hashing/groupByPrefix.js')>();
  return {
    ...mod,
    groupHashesByPrefix: vi.fn(mod.groupHashesByPrefix),
  };
});

const fixturesDir = FIXTURES_DIR;

const originalGroupHashesByPrefix = vi.mocked(groupHashesByPrefix).getMockImplementation();

describe('processSplitDirectory', () => {
  afterEach(() => {
    vi.mocked(groupHashesByPrefix).mockImplementation(originalGroupHashesByPrefix!);
    vi.restoreAllMocks();
  });

  it('handles split directory with matching hashes', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    map.set('B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3', [{ login_password: 'pass2' }]);
    map.set('076D3E6C4B9F654B5B220B9045B7458AB6B4CBC6', [{ login_password: 'pass3' }]);
    const result = await processSplitDirectory(
      map,
      path.join(fixturesDir, 'split-hashes'),
      'ascii',
    );
    expect(result).toHaveLength(3);
    const byHash = new Map(result.map((r) => [r.hash, r]));
    const getLeaks = (hash: string): number | undefined => {
      const entry = byHash.get(hash);
      return entry ? entry.leaks : undefined;
    };
    expect(getLeaks('CBFDAC6008F9CAB4083784CBD1874F76618D2A97')).toBe(1000);
    expect(getLeaks('B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3')).toBe(500);
    expect(getLeaks('076D3E6C4B9F654B5B220B9045B7458AB6B4CBC6')).toBe(250);
  });

  it('handles split directory with no matching hashes', async () => {
    const map = makeMap('0000000000000000000000000000000000000000');
    const result = await processSplitDirectory(
      map,
      path.join(fixturesDir, 'split-hashes'),
      'ascii',
    );
    expect(result).toHaveLength(0);
  });

  it('handles empty split directory', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const result = await processSplitDirectory(
      map,
      path.join(fixturesDir, 'split-hashes-empty'),
      'ascii',
    );
    expect(result).toHaveLength(0);
  });

  it('calls onProgress callback during processing', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const onProgress = vi.fn();

    await processSplitDirectory(
      map,
      path.join(fixturesDir, 'split-hashes'),
      'ascii',
      undefined,
      onProgress,
    );

    expect(onProgress).toHaveBeenCalled();
    const firstCall = onProgress.mock.calls[0][0];
    expect(firstCall.current).toBe(0);
    expect(firstCall.total).toBe(1);
    const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1][0];
    expect(lastCall.current).toBe(1);
    expect(lastCall.total).toBe(1);
  });

  it('returns immediately for empty hash map', async () => {
    const map = new Map<string, PasswordObject[]>();
    const result = await processSplitDirectory(map, '/some/path', 'ascii');
    expect(result).toEqual([]);
  });

  it('handles pending prefixes with delayed reads', async () => {
    vi.useFakeTimers();
    try {
      const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97', [{ login_password: 'pass1' }]);
      map.set('B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3', [{ login_password: 'pass2' }]);
      map.set('076D3E6C4B9F654B5B220B9045B7458AB6B4CBC6', [{ login_password: 'pass3' }]);

      vi.spyOn(fs.promises, 'access').mockRejectedValue(new Error('ENOENT'));
      let readCallCount = 0;
      vi.spyOn(fs.promises, 'readFile').mockImplementation(async () => {
        readCallCount += 1;
        if (readCallCount === 1) {
          return Buffer.from('E6C4B9F654B5B220B9045B7458AB6B4CBC6:1000\n', 'ascii');
        }
        await new Promise((r) => { setTimeout(r, 3000); });
        return Buffer.from('...\n', 'ascii');
      });

      const onProgress = vi.fn();
      const processPromise = processSplitDirectory(map, '/fake/dir', 'ascii', undefined, onProgress);

      await vi.advanceTimersByTimeAsync(10000);
      const results = await processPromise;
      expect(results).toHaveLength(1);
      expect(onProgress).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects when prefix file read fails with non-ENOENT error', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');

    vi.spyOn(fs.promises, 'readFile').mockRejectedValue(
      Object.assign(new Error('Permission denied'), { code: 'EACCES' }),
    );

    await expect(
      processSplitDirectory(map, '/fake/dir', 'ascii'),
    ).rejects.toThrow('Permission denied');
  });

  it('calls onProgress with zero-based current when elapsed is zero', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    try {
      const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');

      vi.spyOn(fs.promises, 'readFile').mockResolvedValue(
        Buffer.from('C6008F9CAB4083784CBD1874F76618D2A97:1000\n', 'ascii'),
      );

      const onProgress = vi.fn();
      await processSplitDirectory(map, '/fake/dir', 'ascii', undefined, onProgress);

      expect(onProgress).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles split directory with multiple hashes sharing same prefix', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    map.set('CBFDA12345678901234567890123456789012345', [{ login_password: 'pass2' }]);
    const result = await processSplitDirectory(
      map,
      path.join(fixturesDir, 'split-hashes-same-prefix'),
      'ascii',
    );
    expect(result).toHaveLength(2);
    const byHash = new Map(result.map((r) => [r.hash, r]));
    expect(byHash.get('CBFDAC6008F9CAB4083784CBD1874F76618D2A97')?.leaks).toBe(1000);
    expect(byHash.get('CBFDA12345678901234567890123456789012345')?.leaks).toBe(999);
  });

  it('respects SPLIT_FILE_CONCURRENCY env var', async () => {
    const prev = process.env.SPLIT_FILE_CONCURRENCY;
    process.env.SPLIT_FILE_CONCURRENCY = '1';
    try {
      const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
      const result = await processSplitDirectory(
        map,
        path.join(fixturesDir, 'split-hashes'),
        'ascii',
      );
      expect(result).toHaveLength(1);
      expect(result[0].leaks).toBe(1000);
    } finally {
      if (prev === undefined) {
        delete process.env.SPLIT_FILE_CONCURRENCY;
      } else {
        process.env.SPLIT_FILE_CONCURRENCY = prev;
      }
    }
  });

  it('warns when prefix file contains rejected lines', async () => {
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(
      Buffer.from('C6008F9CAB4083784CBD1874F76618D2A97:1000\nC6008F9CAB4083784CBD1874F76618D2A97:invalid\n', 'ascii'),
    );
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };
    await processSplitDirectory(map, '/fake/dir', 'ascii', logger);
    expect(logs.some((l) => l.includes('Warning:') && l.includes('invalid format'))).toBe(true);
  });

  it('enriches result not in hashesWithPasswordObjects with empty array (covers ?? [])', async () => {
    const foreignHash = 'AAAAAAAAAA0000000000000000000000000000BB';
    const foreignPrefix = foreignHash.slice(0, 5);
    const foreignSuffix = foreignHash.slice(5);

    vi.mocked(groupHashesByPrefix).mockImplementation(() => {
      const map = new Map();
      const suffixMap = new Map();
      const fpSet = new Set();
      const key1 = Buffer.from(foreignHash, 'ascii').readUInt32BE(5);
      const entry = { fullHash: foreignHash, fullHashBytes: Buffer.from(foreignHash, 'ascii').subarray(0, 40) };
      suffixMap.set(key1, [entry]);
      fpSet.add(key1);
      map.set(foreignPrefix, { map: suffixMap, set: fpSet });
      return map;
    });

    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(
      Buffer.from(`${foreignSuffix}:42\n`, 'ascii'),
    );

    const results = await processSplitDirectory(new Map(), '/fake/dir', 'ascii');
    expect(results).toHaveLength(1);
    expect(results[0].hash).toBe(foreignHash);
    expect(results[0].leaks).toBe(42);
    expect(results[0].passwordObjects).toEqual([]);
  });
});

describe('processSplitDirectory HDD detection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses maxConcurrency=1 and prints HDD message when HDD is detected', async () => {
    mockMeasureSpeed.mockReset();
    mockMeasureSpeed.mockResolvedValue({ iopMBps: 100, isHDD: true });
    vi.spyOn(fs.promises, 'access').mockResolvedValue(undefined as never);
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(
      Buffer.from('C6008F9CAB4083784CBD1874F76618D2A97:1000\n', 'ascii'),
    );
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      const map = new Map<string, Array<{ login_password: string }>>();
      map.set('CBFDAC6008F9CAB4083784CBD1874F76618D2A97', [{ login_password: 'pass' }]);

      const result = await processSplitDirectory(map, '/fake/dir', 'ascii');
      expect(result).toHaveLength(1);
      expect(result[0].leaks).toBe(1000);
      expect(mockMeasureSpeed).toHaveBeenCalledWith('/fake/dir', undefined);
      const allOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(allOutput).toContain('HDD');
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it('warns about missing prefix files via logger', async () => {
    mockMeasureSpeed.mockReset();
    mockMeasureSpeed.mockResolvedValue({ iopMBps: 500, isHDD: false });
    vi.spyOn(fs.promises, 'access').mockResolvedValue(undefined as never);
    vi.spyOn(fs.promises, 'readFile').mockRejectedValue(
      Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' }),
    );

    const map = new Map<string, Array<{ login_password: string }>>();
    map.set('CBFDAC6008F9CAB4083784CBD1874F76618D2A97', [{ login_password: 'pass' }]);
    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };

    await processSplitDirectory(map, '/fake/dir', 'ascii', logger);
    expect(logs.some((l) => l.includes('missing'))).toBe(true);
  });
});

describe('processSplitDirectory invariant guard', () => {
  afterEach(() => {
    vi.mocked(groupHashesByPrefix).mockReset();
  });

  it('throws when prefix not found in suffix map', async () => {
    const fullHash = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';
    const fullHashBuf = Buffer.from(fullHash, 'ascii');
    const suffix = fullHash.slice(5);
    const suffixBuf = Buffer.from(suffix, 'ascii');
    const innerSuffixMap = new Map<number, HashCandidate[]>();
    innerSuffixMap.set(suffixBuf.readUInt32BE(0), [
      {
        fullHash,
        fullHashBytes: fullHashBuf.subarray(0, 40),
        passwordObjects: [{ login_password: 'p1' }] as PasswordObject[],
      },
    ]);

    const proxyMap = new Proxy(
      new Map<string, { map: Map<number, HashCandidate[]>; set: Set<number> }>(
        [['CBFD', { map: innerSuffixMap, set: new Set(innerSuffixMap.keys()) }]],
      ),
      {
        get(target, prop) {
          if (prop === 'keys') {
            return function* fakeKeys() {
              yield 'CBFD';
              yield 'FAKE';
            };
          }
          if (typeof prop === 'string' && typeof Reflect.get(target, prop) === 'function') {
            return Reflect.get(target, prop).bind(target);
          }
          return Reflect.get(target, prop);
        },
      },
    );

    vi.mocked(groupHashesByPrefix).mockReturnValue(proxyMap);

    const map = new Map<string, PasswordObject[]>();
    map.set(
      'CBFDAC6008F9CAB4083784CBD1874F76618D2A97',
      [{ login_password: 'p1' }],
    );

    await expect(
      processSplitDirectory(map, path.join(fixturesDir, 'split-hashes'), 'ascii'),
    ).rejects.toThrow('Invariant: prefix "FAKE" not found in prefixToSuffixMap');
  });
});

describe('processSplitDirectory elapsedMs <= 0', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles elapsedMs <= 0 in avgFilesPerSecond when startTime is in future', async () => {
    const RealDate = globalThis.Date;
    let firstDate = true;

    class FutureStartDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0 && firstDate) {
          firstDate = false;
          super(8640000000000000);
        } else {
          super(...(args as ConstructorParameters<typeof RealDate>));
        }
      }
    }
    globalThis.Date = FutureStartDate as unknown as typeof Date;

    try {
      const hash1 = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';
      const hash2 = 'A7BFC6008F9CAB4083784CBD1874F76618D2A97';
      const map = makeMap(hash1);
      map.set(hash2, [{ login_password: 'pass2' }]);

      let callCount = 0;
      vi.spyOn(fs.promises, 'readFile').mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) {
          return Buffer.from(`${hash1.slice(5)}:1000\n`, 'ascii');
        }
        await new Promise((r) => { setTimeout(r); });
        return Buffer.from(`${hash2.slice(5)}:500\n`, 'ascii');
      });

      const onProgress = vi.fn();
      await processSplitDirectory(map, '/fake/dir', 'ascii', undefined, onProgress);

      expect(onProgress).toHaveBeenCalled();
      const progressCalls = onProgress.mock.calls.filter(
        (c: unknown[]) => c[0].speed !== undefined,
      );
      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls[0][0].speed).toBe(0);
    } finally {
      globalThis.Date = RealDate;
    }
  });

  it('handles totalElapsed === 0 when Date.now equals startTime', async () => {
    const FIXED_TS = 1700000000000;
    vi.useFakeTimers({ now: FIXED_TS });

    try {
      const hash1 = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';
      const map = makeMap(hash1);
      vi.spyOn(fs.promises, 'readFile').mockResolvedValue(
        Buffer.from(`${hash1.slice(5)}:1000\n`, 'ascii'),
      );

      const logger = vi.fn();
      await processSplitDirectory(map, '/fake/dir', 'ascii', logger);

      expect(logger).toHaveBeenCalledWith(
        expect.stringContaining('0 files per second'),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
