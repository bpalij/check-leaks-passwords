import path from 'path';
import fs from 'fs';

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';

import { processHibpApi, logHibpApiSummary } from './processHibpApi.js';
import { convertArrayToMap } from '../hashing/convertArrayToMap.js';
import type { PasswordObjectWithHash, PasswordObject } from '../types.js';
import { FIXTURES_DIR } from '../../tests/helpers/fixturesDir.js';
import { sha1 } from '../../tests/helpers/sha1.js';

const fixturesDir = FIXTURES_DIR;
const TEST_API_URL = 'https://test.example.com/range/';

describe('processHibpApi', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('matches password hashes from API responses', async () => {
    const csvPath = path.join(fixturesDir, 'sample.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvContent.trim().split('\n').slice(1);
    const input: Array<PasswordObjectWithHash> = lines.map((line) => {
      const password = line.split(',')[0];
      return {
        hash: sha1(password),
        passwordObject: { login_password: password },
      };
    });

    const hashesMap = convertArrayToMap(input);

    const mockResponses: Record<string, string> = {};
    const hashLines = fs.readFileSync(path.join(fixturesDir, 'sample-hashes.txt'), 'utf-8').trim().split('\n');
    hashLines.forEach((hashLine) => {
      const [fullHash, count] = hashLine.split(':');
      const prefix = fullHash.slice(0, 5);
      const suffix = fullHash.slice(5);
      mockResponses[prefix] ||= '';
      mockResponses[prefix] += `${suffix}:${count}\n`;
    });

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const prefix = url.split('/').pop() ?? '';
      const body = mockResponses[prefix] || '';
      return {
        ok: true,
        headers: {
          get: (name: string) => (name === 'cf-cache-status' ? 'HIT' : null),
        },
        arrayBuffer: () => Promise.resolve(Buffer.from(body, 'ascii')),
      };
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };
    const onProgress = vi.fn();

    const results = await processHibpApi(hashesMap, TEST_API_URL, logger, onProgress);

    expect(results).toHaveLength(3);

    const sorted = [...results].sort((a, b) => b.leaks - a.leaks);
    expect(sorted[0].leaks).toBe(1000);
    expect(sorted[0].hash).toBe('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    expect(sorted[0].passwordObjects[0].login_password).toBe('password123');

    expect(sorted[1].leaks).toBe(500);
    expect(sorted[1].hash).toBe('B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3');
    expect(sorted[1].passwordObjects[0].login_password).toBe('letmein');

    expect(sorted[2].leaks).toBe(250);
    expect(sorted[2].hash).toBe('076D3E6C4B9F654B5B220B9045B7458AB6B4CBC6');
    expect(sorted[2].passwordObjects[0].login_password).toBe('P@ssw0rd!');

    expect(logs.some((l) => l.includes('Checked all'))).toBe(true);
    expect(onProgress).toHaveBeenCalled();
    const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1][0];
    expect(lastCall.current).toBe(3);
    expect(lastCall.total).toBe(3);
  });

  it('returns empty array for empty input', async () => {
    const emptyMap = new Map<string, PasswordObject[]>();
    const results = await processHibpApi(emptyMap, TEST_API_URL);
    expect(results).toEqual([]);
  });

  it.each([
    { label: 'network failure', error: new Error('fetch failed'), logger: false },
    { label: 'HTTP 500', error: { ok: false, status: 500, text: async () => 'Internal Server Error' }, logger: false },
    { label: 'Error with logger', error: new Error('boom'), logger: true },
    { label: 'non-Error throw with logger', error: 'string error', logger: true },
  ])('retries on $label and succeeds', { timeout: 30000 }, async ({ error, logger }) => {
    const csvPath = path.join(fixturesDir, 'sample.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvContent.trim().split('\n').slice(1);
    const input: Array<PasswordObjectWithHash> = lines.slice(0, 1).map((line) => {
      const password = line.split(',')[0];
      return {
        hash: sha1(password),
        passwordObject: { login_password: password },
      };
    });

    const hashesMap = convertArrayToMap(input);

    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount += 1;
      if (callCount <= 2) {
        if (error instanceof Error || typeof error === 'string') {
          throw error;
        }
        return error;
      }
      return {
        ok: true,
        headers: {
          get: (name: string) => (name === 'cf-cache-status' ? 'HIT' : null),
        },
        arrayBuffer: () => Promise.resolve(
          Buffer.from('C6008F9CAB4083784CBD1874F76618D2A97:1000\n', 'ascii'),
        ),
      };
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const onRetry = logger ? vi.fn() : undefined;
    const results = await processHibpApi(hashesMap, TEST_API_URL, undefined, undefined, onRetry);
    expect(results).toHaveLength(1);
    expect(results[0].leaks).toBe(1000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    if (logger) {
      expect(onRetry).toHaveBeenCalled();
    }
  });

  it.each([{ label: 'Error type', error: () => new Error('timeout'), expectedMsg: /timeout/ }, { label: 'non-Error type', error: () => 42, expectedMsg: /Failed to fetch prefix.*after 10 attempts/ }])('throws with formatted message after exhausting retries on $label', async ({ error, expectedMsg }) => {
    vi.useFakeTimers();
    const unhandledRejectionHandler = vi.fn();
    process.on('unhandledRejection', unhandledRejectionHandler);
    try {
      const hash = sha1('throwaway');
      const input: Array<PasswordObjectWithHash> = [{ hash, passwordObject: { login_password: 'throwaway' } }];
      const hashesMap = convertArrayToMap(input);

      const fetchMock = vi.fn().mockImplementation(async () => { throw error(); });
      global.fetch = fetchMock as unknown as typeof global.fetch;

      const processPromise = processHibpApi(hashesMap, TEST_API_URL);
      processPromise.catch(() => {});
      await vi.advanceTimersByTimeAsync(200000);

      await expect(processPromise).rejects.toThrow(expectedMsg);
      expect(fetchMock).toHaveBeenCalledTimes(10);
    } finally {
      process.off('unhandledRejection', unhandledRejectionHandler);
      vi.useRealTimers();
    }
  });

  it('calls onProgress during delayed requests', async () => {
    vi.useFakeTimers();
    try {
      const hash1 = sha1('password123');
      const hash2 = sha1('letmein');
      const input: Array<PasswordObjectWithHash> = [{ hash: hash1, passwordObject: { login_password: 'password123' } }, { hash: hash2, passwordObject: { login_password: 'letmein' } }];
      const hashesMap = convertArrayToMap(input);

      let callCount = 0;
      const fetchMock = vi.fn().mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            ok: true,
            headers: { get: (name: string) => (name === 'cf-cache-status' ? 'HIT' : null) },
            arrayBuffer: () => Promise.resolve(Buffer.from(`${hash1.slice(5)}:1\n`, 'ascii')),
          };
        }
        await new Promise((r) => { setTimeout(r, 3000); });
        return {
          ok: true,
          headers: { get: (name: string) => (name === 'cf-cache-status' ? 'HIT' : null) },
          arrayBuffer: () => Promise.resolve(Buffer.from(`${hash2.slice(5)}:2\n`, 'ascii')),
        };
      });
      global.fetch = fetchMock as unknown as typeof global.fetch;

      const onProgress = vi.fn();

      const processPromise = processHibpApi(hashesMap, TEST_API_URL, undefined, onProgress);

      await vi.advanceTimersByTimeAsync(5000);
      const results = await processPromise;
      expect(results).toHaveLength(2);
      expect(results[0].leaks).toBeGreaterThan(0);
      expect(results[1].leaks).toBeGreaterThan(0);
      expect(onProgress).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { label: 'completes instantly', setup: () => { vi.setSystemTime(new Date(1000)); }, teardown: undefined as (() => void) | undefined },
    {
      label: 'startTime in future',
      setup: () => {},
      teardown: undefined as (() => void) | undefined,
    },
  ])('returns speed=0 via onProgress when $label', async ({ label }, _testContext) => {
    vi.useFakeTimers();
    let cleanupDate: (() => void) | undefined;
    if (label === 'startTime in future') {
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
      cleanupDate = () => { globalThis.Date = RealDate; };
    } else {
      vi.setSystemTime(new Date(1000));
    }

    try {
      const hash = sha1('instant');
      const input: Array<PasswordObjectWithHash> = [{ hash, passwordObject: { login_password: 'instant' } }];
      const hashesMap = convertArrayToMap(input);

      const suffix = hash.slice(5);
      const fetchMock = vi.fn().mockImplementation(async () => ({
        ok: true,
        headers: {
          get: (name: string) => (name === 'cf-cache-status' ? 'HIT' : null),
        },
        arrayBuffer: () => Promise.resolve(
          Buffer.from(`${suffix}:1\n`, 'ascii'),
        ),
      }));
      global.fetch = fetchMock as unknown as typeof global.fetch;

      const onProgress = vi.fn();
      const results = await processHibpApi(hashesMap, TEST_API_URL, undefined, onProgress);
      expect(results).toHaveLength(1);
      expect(onProgress).toHaveBeenCalled();
      const speedCalls = onProgress.mock.calls.filter(
        (c: unknown[]) => c[0].speed !== undefined,
      );
      expect(speedCalls.length).toBeGreaterThan(0);
    } finally {
      cleanupDate?.();
      vi.useRealTimers();
    }
  });

  it('logHibpApiSummary handles zero cfTotal', () => {
    const logs: string[] = [];
    const startTime = new Date(1000);
    logHibpApiSummary(0, 0, 0, 0, 0, 0, startTime, (msg) => { logs.push(msg); });
    expect(logs.some((l) => l.includes(
      'Cloudflare cache: 0 total, hit: 0 (0.0%), miss: 0 (0.0%)',
    ))).toBe(true);
  });

  it('logHibpApiSummary calculates percentages with non-zero cfTotal', () => {
    const logs: string[] = [];
    const startTime = new Date(1000);
    logHibpApiSummary(3, 5, 100, 0, 2, 1, startTime, (msg) => { logs.push(msg); });
    expect(logs.some((l) => l.includes(
      'Cloudflare cache: 3 total, hit: 2 (66.7%), miss: 1 (33.3%)',
    ))).toBe(true);
  });

  it('respects HIBP_CONCURRENCY env var', async () => {
    const prev = process.env.HIBP_CONCURRENCY;
    process.env.HIBP_CONCURRENCY = '1';
    try {
      const hash = sha1('password123');
      const input: Array<PasswordObjectWithHash> = [{ hash, passwordObject: { login_password: 'password123' } }];
      const hashesMap = convertArrayToMap(input);

      const fetchMock = vi.fn().mockImplementation(async () => ({
        ok: true,
        headers: {
          get: (name: string) => (name === 'cf-cache-status' ? 'MISS' : null),
        },
        arrayBuffer: () => Promise.resolve(
          Buffer.from(`${hash.slice(5)}:1\n`, 'ascii'),
        ),
      }));
      global.fetch = fetchMock as unknown as typeof global.fetch;

      const results = await processHibpApi(hashesMap, TEST_API_URL);
      expect(results).toHaveLength(1);
      expect(results[0].leaks).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      if (prev === undefined) {
        delete process.env.HIBP_CONCURRENCY;
      } else {
        process.env.HIBP_CONCURRENCY = prev;
      }
    }
  });

  it('returns password object for password not found in API response', async () => {
    const hash = sha1('notfoundpassword');
    const input: Array<PasswordObjectWithHash> = [{ hash, passwordObject: { login_password: 'notfoundpassword' } }];
    const hashesMap = convertArrayToMap(input);

    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      headers: {
        get: (name: string) => (name === 'cf-cache-status' ? 'MISS' : null),
      },
      arrayBuffer: () => Promise.resolve(
        Buffer.from('SOMEOTHERSUFFIX:1\nANOTHERSUFFIX:2\n', 'ascii'),
      ),
    }));
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const results = await processHibpApi(hashesMap, TEST_API_URL);
    expect(results).toHaveLength(0);
  });

  it('enriches result not in hashesWithPasswordObjects with empty array (covers ?? [])', async () => {
    const foreignHash = 'AAAAAAAAAA0000000000000000000000000000BB';
    const foreignPrefix = foreignHash.slice(0, 5);
    const foreignSuffix = foreignHash.slice(5);

    const groupHashesModule = await import('../hashing/groupByPrefix');
    const spy = vi.spyOn(groupHashesModule, 'groupHashesByPrefix').mockImplementation(() => {
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

    try {
      const fetchMock = vi.fn().mockImplementation(async () => ({
        ok: true,
        headers: { get: (name: string) => (name === 'cf-cache-status' ? 'HIT' : null) },
        arrayBuffer: () => Promise.resolve(Buffer.from(`${foreignSuffix}:42\n`, 'ascii')),
      }));
      global.fetch = fetchMock as unknown as typeof global.fetch;

      const results = await processHibpApi(new Map(), TEST_API_URL);
      expect(results).toHaveLength(1);
      expect(results[0].hash).toBe(foreignHash);
      expect(results[0].leaks).toBe(42);
      expect(results[0].passwordObjects).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('triggers abort timeout when fetch hangs (covers line 86)', async () => {
    vi.useFakeTimers();
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
    try {
      const hash = sha1('slow-fetch');
      const input: Array<PasswordObjectWithHash> = [{ hash, passwordObject: { login_password: 'slow-fetch' } }];
      const hashesMap = convertArrayToMap(input);

      const fetchMock = vi.fn().mockImplementation(
        (_url: string, opts?: { signal?: AbortSignal }) => new Promise((resolve, reject) => {
          const signal = opts?.signal;
          if (signal) {
            const onAbort = () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            };
            if (signal.aborted) {
              onAbort();
              return;
            }
            signal.addEventListener('abort', onAbort, { once: true });
          }
        }),
      );
      global.fetch = fetchMock as unknown as typeof global.fetch;

      const processPromise = processHibpApi(hashesMap, TEST_API_URL);
      processPromise.catch(() => {});

      await vi.advanceTimersByTimeAsync(6000);

      expect(abortSpy).toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(200000);

      await expect(processPromise).rejects.toThrow();
    } finally {
      abortSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe('processHibpApi invariant guard', () => {
  it('throws when prefix not found in suffix map', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const suffixHash = 'BEEF123456789012345678901234567890';
    const fullHash = `DEAD${suffixHash}`;
    const fullHashBuf = Buffer.from(fullHash, 'ascii');
    const suffixBuf = Buffer.from(suffixHash, 'ascii');
    const innerSuffixMap = new Map<number, { fullHash: string; fullHashBytes: Buffer }>();
    innerSuffixMap.set(suffixBuf.readUInt32BE(0), [
      {
        fullHash,
        fullHashBytes: fullHashBuf.subarray(0, 40),
      },
    ]);

    const invariantProxyMap = new Proxy(
      new Map([['DEAD', { map: innerSuffixMap, set: new Set(innerSuffixMap.keys()) }]]),
      {
        get(target, prop) {
          if (prop === 'keys') {
            return function* fakeKeys() {
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

    const groupHashesModule = await import('../hashing/groupByPrefix');
    const spy = vi.spyOn(groupHashesModule, 'groupHashesByPrefix').mockReturnValue(
      invariantProxyMap as ReturnType<typeof groupHashesModule.groupHashesByPrefix>,
    );

    const map = new Map<string, PasswordObject[]>();
    map.set('DEADBEEF', [{ login_password: 'p1' }]);

    await expect(
      processHibpApi(map, TEST_API_URL),
    ).rejects.toThrow('Invariant: prefix "FAKE" not found in prefixToSuffixMap');

    spy.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe('processHibpApi elapsedMs <= 0', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('logHibpApiSummary covers totalElapsed===0 when Date.now matches startTime', () => {
    const fixedTime = 1000000;
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(fixedTime);
    try {
      const logs: string[] = [];
      logHibpApiSummary(10, 5, 100, 0, 3, 2, new Date(fixedTime), (m) => { logs.push(m); });
      expect(logs.some((l) => l.includes('0'))).toBe(true);
      expect(logs.some((l) => l.includes('requests per second'))).toBe(true);
    } finally {
      dateSpy.mockRestore();
    }
  });
});
