import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import processHibpApi from '../src/helpers/processHibpApi';
import convertArrayWithHashesToMap from '../src/helpers/convertArrayWithHashesToMap';
import { passwordObjectWithHash } from '../src/interfaces/types';

const fixturesDir = path.resolve(__dirname, 'fixtures');

function sha1(password: string): string {
  return crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
}

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
    const input: Array<passwordObjectWithHash> = lines.map((line) => {
      const password = line.split(',')[0];
      return {
        hash: sha1(password),
        passwordObject: { login_password: password },
      };
    });

    const hashesMap = convertArrayWithHashesToMap(input);

    const mockResponses: Record<string, string> = {};
    const hashLines = fs.readFileSync(path.join(fixturesDir, 'sample-hashes.txt'), 'utf-8').trim().split('\n');
    hashLines.forEach((hashLine) => {
      const [fullHash, count] = hashLine.split(':');
      const prefix = fullHash.slice(0, 5);
      const suffix = fullHash.slice(5);
      if (!mockResponses[prefix]) {
        mockResponses[prefix] = '';
      }
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

    const results = await processHibpApi(hashesMap, logger);

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

    expect(logs.some((l) => l.includes('Already checked 3 from 3'))).toBe(true);
    expect(logs.some((l) => l.includes('Already checked 0 from 3'))).toBe(true);
    expect(logs.some((l) => l.includes('Estimated time remaining: finishing up...'))).toBe(true);
    expect(logs.some((l) => l.includes('Checked all'))).toBe(true);
  });

  it('returns empty array for empty input', async () => {
    const emptyMap = new Map();
    const results = await processHibpApi(emptyMap);
    expect(results).toEqual([]);
  });

  it('retries on network failure', { timeout: 30000 }, async () => {
    const csvPath = path.join(fixturesDir, 'sample.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvContent.trim().split('\n').slice(1);
    const input: Array<passwordObjectWithHash> = lines.slice(0, 1).map((line) => {
      const password = line.split(',')[0];
      return {
        hash: sha1(password),
        passwordObject: { login_password: password },
      };
    });

    const hashesMap = convertArrayWithHashesToMap(input);

    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount += 1;
      if (callCount <= 2) {
        throw new Error('Network error');
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

    const results = await processHibpApi(hashesMap);
    expect(results).toHaveLength(1);
    expect(results[0].leaks).toBe(1000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries on HTTP error response', { timeout: 30000 }, async () => {
    const csvPath = path.join(fixturesDir, 'sample.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvContent.trim().split('\n').slice(1);
    const input: Array<passwordObjectWithHash> = lines.slice(0, 1).map((line) => {
      const password = line.split(',')[0];
      return {
        hash: sha1(password),
        passwordObject: { login_password: password },
      };
    });

    const hashesMap = convertArrayWithHashesToMap(input);

    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount += 1;
      if (callCount <= 2) {
        return { ok: false };
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

    const results = await processHibpApi(hashesMap);
    expect(results).toHaveLength(1);
    expect(results[0].leaks).toBe(1000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('logs retry attempts when logger provided', { timeout: 30000 }, async () => {
    const csvPath = path.join(fixturesDir, 'sample.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvContent.trim().split('\n').slice(1);
    const input: Array<passwordObjectWithHash> = lines.slice(0, 1).map((line) => {
      const password = line.split(',')[0];
      return {
        hash: sha1(password),
        passwordObject: { login_password: password },
      };
    });

    const hashesMap = convertArrayWithHashesToMap(input);

    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount += 1;
      if (callCount <= 2) {
        throw new Error('Network error');
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

    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };

    const results = await processHibpApi(hashesMap, logger);
    expect(results).toHaveLength(1);
    expect(results[0].leaks).toBe(1000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(logs.some((l) => l.includes('Failed attempt #1'))).toBe(true);
    expect(logs.some((l) => l.includes('Failed attempt #2'))).toBe(true);
  });

  it('throws after exhausting all retries', async () => {
    vi.useFakeTimers();
    const unhandledRejectionHandler = vi.fn();
    process.on('unhandledRejection', unhandledRejectionHandler);
    try {
      const hash = sha1('throwaway');
      const input: Array<passwordObjectWithHash> = [
        { hash, passwordObject: { login_password: 'throwaway' } },
      ];
      const hashesMap = convertArrayWithHashesToMap(input);

      const fetchMock = vi.fn().mockImplementation(async () => { throw new Error('Network error'); });
      global.fetch = fetchMock as unknown as typeof global.fetch;

      const processPromise = processHibpApi(hashesMap);
      await vi.advanceTimersByTimeAsync(200000);

      await expect(processPromise).rejects.toThrow('Network error');
      expect(fetchMock).toHaveBeenCalledTimes(10);
    } finally {
      process.off('unhandledRejection', unhandledRejectionHandler);
      vi.useRealTimers();
    }
  });

  it('retries on non-Error throw with logger', { timeout: 30000 }, async () => {
    const csvPath = path.join(fixturesDir, 'sample.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvContent.trim().split('\n').slice(1);
    const input: Array<passwordObjectWithHash> = lines.slice(0, 1).map((line) => {
      const password = line.split(',')[0];
      return {
        hash: sha1(password),
        passwordObject: { login_password: password },
      };
    });

    const hashesMap = convertArrayWithHashesToMap(input);

    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount += 1;
      if (callCount <= 2) {
        // eslint-disable-next-line no-throw-literal
        throw 'timeout string';
      }
      return {
        ok: true,
        headers: {
          get: (name: string) => (name === 'cf-cache-status' ? 'MISS' : null),
        },
        arrayBuffer: () => Promise.resolve(
          Buffer.from('C6008F9CAB4083784CBD1874F76618D2A97:1000\n', 'ascii'),
        ),
      };
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };

    const results = await processHibpApi(hashesMap, logger);
    expect(results).toHaveLength(1);
    expect(results[0].leaks).toBe(1000);
    expect(logs.some((l) => l.includes('Failed attempt #1 while fetching prefix'))).toBe(true);
    expect(logs.some((l) => l.includes('timeout string'))).toBe(true);
  });

  it('throws with formatted message after exhausting retries on non-Error throw', async () => {
    vi.useFakeTimers();
    const unhandledRejectionHandler = vi.fn();
    process.on('unhandledRejection', unhandledRejectionHandler);
    try {
      const hash = sha1('throwaway');
      const input: Array<passwordObjectWithHash> = [
        { hash, passwordObject: { login_password: 'throwaway' } },
      ];
      const hashesMap = convertArrayWithHashesToMap(input);

      const fetchMock = vi.fn().mockImplementation(async () => {
        // eslint-disable-next-line no-throw-literal
        throw 42;
      });
      global.fetch = fetchMock as unknown as typeof global.fetch;

      const processPromise = processHibpApi(hashesMap);
      await vi.advanceTimersByTimeAsync(200000);

      await expect(processPromise).rejects.toThrow('Failed to fetch prefix');
      await expect(processPromise).rejects.toThrow('after 10 attempts');
      expect(fetchMock).toHaveBeenCalledTimes(10);
    } finally {
      process.off('unhandledRejection', unhandledRejectionHandler);
      vi.useRealTimers();
    }
  });

  it('logs ETA when some prefix requests are still pending', async () => {
    vi.useFakeTimers();
    try {
      const hash1 = sha1('password123');
      const hash2 = sha1('letmein');
      const input: Array<passwordObjectWithHash> = [
        { hash: hash1, passwordObject: { login_password: 'password123' } },
        { hash: hash2, passwordObject: { login_password: 'letmein' } },
      ];
      const hashesMap = convertArrayWithHashesToMap(input);

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
        await new Promise((r) => setTimeout(r, 2000));
        return {
          ok: true,
          headers: { get: (name: string) => (name === 'cf-cache-status' ? 'HIT' : null) },
          arrayBuffer: () => Promise.resolve(Buffer.from(`${hash2.slice(5)}:2\n`, 'ascii')),
        };
      });
      global.fetch = fetchMock as unknown as typeof global.fetch;

      const logs: string[] = [];
      const logger = (msg: string) => { logs.push(msg); };

      const processPromise = processHibpApi(hashesMap, logger);

      await vi.advanceTimersByTimeAsync(1000);
      expect(logs.some((l) => l.includes('Estimated time remaining'))).toBe(true);

      await vi.advanceTimersByTimeAsync(2000);

      const results = await processPromise;
      expect(results).toHaveLength(2);
      expect(results[0].leaks).toBeGreaterThan(0);
      expect(results[1].leaks).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs zero elapsed time when processing completes instantly', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1000));
    try {
      const hash = sha1('instant');
      const input: Array<passwordObjectWithHash> = [
        { hash, passwordObject: { login_password: 'instant' } },
      ];
      const hashesMap = convertArrayWithHashesToMap(input);

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

      const logs: string[] = [];
      const logger = (msg: string) => { logs.push(msg); };

      const results = await processHibpApi(hashesMap, logger);
      expect(results).toHaveLength(1);
      expect(logs.some((l) => l.includes('0 avg requests per second'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns password object for password not found in API response', async () => {
    const hash = sha1('notfoundpassword');
    const input: Array<passwordObjectWithHash> = [
      { hash, passwordObject: { login_password: 'notfoundpassword' } },
    ];
    const hashesMap = convertArrayWithHashesToMap(input);

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

    const results = await processHibpApi(hashesMap);
    expect(results).toHaveLength(0);
  });
});
