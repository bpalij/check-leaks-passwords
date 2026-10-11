import http from 'http';

import {
  describe,
  it,
  expect,
  afterEach,
} from 'vitest';

import { processHibpApi } from './processHibpApi.js';
import { convertArrayToMap } from '../hashing/convertArrayToMap.js';
import type { PasswordObjectWithHash } from '../types.js';
import { sha1 } from '../../tests/helpers/sha1.js';

function createMockHibpServer(
  hashToCount: Map<string, number>,
  options?: { failFirst?: number; holdOpenMs?: number },
) {
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    requestCount += 1;
    const url = req.url ?? '';
    const prefix = url.replace('/', '');

    if (options?.failFirst && requestCount <= options.failFirst) {
      res.writeHead(500);
      res.end('Internal Server Error');
      return;
    }

    if (options?.holdOpenMs) {
      setTimeout(() => {
        const lines: string[] = [];
        hashToCount.forEach((count, fullHash) => {
          if (fullHash.startsWith(prefix)) {
            lines.push(`${fullHash.slice(5)}:${count}`);
          }
        });
        res.writeHead(200, { 'cf-cache-status': 'MISS' });
        res.end(lines.join('\n'));
      }, options.holdOpenMs);
      return;
    }

    const lines: string[] = [];
    hashToCount.forEach((count, fullHash) => {
      if (fullHash.startsWith(prefix)) {
        lines.push(`${fullHash.slice(5)}:${count}`);
      }
    });
    res.writeHead(200, { 'cf-cache-status': 'MISS' });
    res.end(lines.join('\n'));
  });

  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        throw new Error('Server has no address');
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}/`,
        close: () => new Promise<void>((res, rej) => {
          server.close((err) => (err ? rej(err) : res()));
        }),
      });
    });
  });
}

describe('processHibpApi — integration with real HTTP', () => {
  let server: { url: string; close: () => Promise<void> } | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('matches password hashes from a real HTTP server', async () => {
    const hashToCount = new Map<string, number>();
    const passwords = [
      'password123',
      'letmein',
      'P@ssw0rd!',
    ];
    passwords.forEach((pw) => {
      hashToCount.set(sha1(pw), Math.floor(Math.random() * 1000) + 1);
    });

    server = await createMockHibpServer(hashToCount);

    const input: Array<PasswordObjectWithHash> = passwords.map((pw) => ({
      hash: sha1(pw),
      passwordObject: { login_password: pw },
    }));
    const hashesMap = convertArrayToMap(input);

    const results = await processHibpApi(hashesMap, server.url);

    expect(results).toHaveLength(3);
    results.forEach((r) => {
      expect(r.leaks).toBeGreaterThan(0);
      expect(r.passwordObjects.length).toBeGreaterThan(0);
    });
  });

  it('retries on server 500 errors and succeeds', async () => {
    const hashToCount = new Map<string, number>();
    hashToCount.set(sha1('retrypass'), 99);

    server = await createMockHibpServer(hashToCount, { failFirst: 2 });

    const input: Array<PasswordObjectWithHash> = [{ hash: sha1('retrypass'), passwordObject: { login_password: 'retrypass' } }];
    const hashesMap = convertArrayToMap(input);

    const retryMessages: string[] = [];
    const results = await processHibpApi(
      hashesMap,
      server.url,
      undefined,
      undefined,
      (msg) => { retryMessages.push(msg); },
    );

    expect(results).toHaveLength(1);
    expect(results[0].leaks).toBe(99);
    expect(retryMessages.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty array when no hashes match', async () => {
    const hashToCount = new Map<string, number>();
    hashToCount.set('AAAAAAAAAA0000000000000000000000000000BB', 50);

    server = await createMockHibpServer(hashToCount);

    const input: Array<PasswordObjectWithHash> = [{ hash: sha1('nobody'), passwordObject: { login_password: 'nobody' } }];
    const hashesMap = convertArrayToMap(input);

    const results = await processHibpApi(hashesMap, server.url);
    expect(results).toHaveLength(0);
  });

  it('handles empty input without making HTTP requests', async () => {
    server = await createMockHibpServer(new Map());

    const results = await processHibpApi(new Map(), server.url);
    expect(results).toEqual([]);
  });

  it('tracks Cloudflare cache headers from real responses', async () => {
    const hashToCount = new Map<string, number>();
    hashToCount.set(sha1('cachedpw'), 7);

    server = await createMockHibpServer(hashToCount);

    const input: Array<PasswordObjectWithHash> = [{ hash: sha1('cachedpw'), passwordObject: { login_password: 'cachedpw' } }];
    const hashesMap = convertArrayToMap(input);

    const logs: string[] = [];
    await processHibpApi(hashesMap, server.url, (msg) => { logs.push(msg); });

    expect(logs.some((l) => l.includes('Cloudflare cache'))).toBe(true);
    expect(logs.some((l) => l.includes('miss: 1'))).toBe(true);
  });
});
