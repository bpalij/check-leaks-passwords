import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

import { vi } from 'vitest';

import { processDataLeaks } from './processDataLeaks.js';
import * as determineOptimalChunkCountModule from '../memory/determineOptimalChunkCount.js';
import type { PasswordObject } from '../types.js';
import { FIXTURES_DIR } from '../../tests/helpers/fixturesDir.js';
import { makeMap } from '../../tests/helpers/makeMap.js';
import { writeLargeSha1Corpus } from '../../tests/helpers/largeCorpus.js';
import { makeTestDir } from '../../tests/helpers/testTmp.js';

const fixturesDir = FIXTURES_DIR;

// A corpus above the (overridden) sortedness threshold is required to build an
// `.idx`; 96 KiB clears the 80 KiB non-overlap floor.
const SMALL_CORPUS_BYTES = 96 * 1024;
const SMALL_FILE_THRESHOLD_ENV = '65536';

describe('processDataLeaks', () => {
  it('dispatches to processSingleFile for a file path and returns matching hashes', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const result = await processDataLeaks(
      map,
      path.join(fixturesDir, 'sample-hashes.txt'),
      'ascii',
    );
    expect(result).toHaveLength(1);
    expect(result[0].leaks).toBe(1000);
  });

  it('dispatches to processSplitDirectory for a directory path and returns matching hashes', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const result = await processDataLeaks(
      map,
      path.join(fixturesDir, 'split-hashes'),
      'ascii',
    );
    expect(result).toHaveLength(1);
    expect(result[0].leaks).toBe(1000);
  });

  it('rejects on non-existent path', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    await expect(
      processDataLeaks(map, '/nonexistent/path.txt', 'ascii'),
    ).rejects.toThrow();
  });

  it('forwards onProgress to single file path', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const onProgress = vi.fn();
    const result = await processDataLeaks(
      map,
      path.join(fixturesDir, 'sample-hashes.txt'),
      'ascii',
      undefined,
      onProgress,
    );
    expect(result).toHaveLength(1);
    expect(onProgress).toHaveBeenCalled();
  });

  it('fingerprint filter does not prevent real matches from being found', async () => {
    const map = new Map<string, PasswordObject[]>();
    const targetHash = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';

    map.set(targetHash, [{ login_password: 'real-password' }]);
    map.set('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', [{ login_password: 'decoy' }]);
    map.set('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', [{ login_password: 'decoy2' }]);
    map.set('CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC', [{ login_password: 'decoy3' }]);
    const result = await processDataLeaks(
      map,
      path.join(fixturesDir, 'sample-hashes.txt'),
      'ascii',
    );
    expect(result).toHaveLength(1);
    expect(result[0].hash).toBe(targetHash);
    expect(result[0].leaks).toBe(1000);
  });

  it('fingerprint filter with many decoy hashes returns zero results when nothing matches', async () => {
    const map = new Map<string, PasswordObject[]>();
    map.set('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', [{ login_password: 'nope' }]);
    map.set('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', [{ login_password: 'nope2' }]);
    const result = await processDataLeaks(
      map,
      path.join(fixturesDir, 'sample-hashes.txt'),
      'ascii',
    );
    expect(result).toHaveLength(0);
  });

  it('dispatches with 2 chunks and logs chunk count', async () => {
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount')
      .mockResolvedValue({
        chunkCount: 2,
        isHDD: false,
        iopMBps: 500,
        preCheckSkipped: false,
        testDurationMs: 128,
      });

    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const logs: string[] = [];
    const result = await processDataLeaks(
      map,
      path.join(fixturesDir, 'sample-hashes.txt'),
      'ascii',
      (msg: string) => { logs.push(msg); },
    );

    expect(result).toHaveLength(1);
    expect(result[0].leaks).toBe(1000);
    expect(logs.some((l) => l.includes('using 2 chunks'))).toBe(true);

    vi.restoreAllMocks();
  });

  describe('read-mode parameterized', () => {
    const targetHash = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';

    it('sequential mode matches correctly', async () => {
      const map = makeMap(targetHash);
      const result = await processDataLeaks(
        map,
        path.join(fixturesDir, 'sample-hashes.txt'),
        'ascii',
        undefined,
        undefined,
        'sequential',
      );
      expect(result).toHaveLength(1);
      expect(result[0].leaks).toBe(1000);
    });

    it('binary mode matches correctly', async () => {
      const map = makeMap('0000000000000000000000000000000000000000');
      const result = await processDataLeaks(
        map,
        path.join(fixturesDir, 'sorted-hashes.txt'),
        'ascii',
        undefined,
        undefined,
        'binary',
      );
      expect(result).toHaveLength(1);
      expect(result[0].leaks).toBe(1123);
    });
  });

  describe('build index end-to-end', () => {
    it('creates .idx file and index mode reads it', { timeout: 120000 }, async () => {
      const tmpDir = makeTestDir('dwl-idx-');
      const savedThreshold = process.env.SMALL_FILE_BYTES_THRESHOLD;
      process.env.SMALL_FILE_BYTES_THRESHOLD = SMALL_FILE_THRESHOLD_ENV;
      try {
        const hashFile = path.join(tmpDir, 'hashes.txt');
        // A `.idx` is only built for verified-sorted input, so the corpus is
        // kept above the overridden threshold to run the live sortedness check.
        const { matches } = writeLargeSha1Corpus(
          hashFile,
          SMALL_CORPUS_BYTES,
          [256],
          7,
        );

        const result = await processDataLeaks(
          makeMap(matches[0].hash),
          hashFile,
          'ascii',
          undefined,
          undefined,
          'sequential',
          true,
        );
        expect(result).toHaveLength(1);
        expect(result[0].leaks).toBe(7);

        const idxPath = `${hashFile}.idx`;
        expect(fs.existsSync(idxPath)).toBe(true);
        const idxStat = fs.statSync(idxPath);
        expect(idxStat.size).toBeGreaterThan(0);
      } finally {
        if (savedThreshold === undefined) delete process.env.SMALL_FILE_BYTES_THRESHOLD;
        else process.env.SMALL_FILE_BYTES_THRESHOLD = savedThreshold;
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe('generated dataset', () => {
    it('matches known hashes and returns no results for unknown hashes', async () => {
      const tmpDir = makeTestDir('dwl-gen-');
      try {
        const hashFile = path.join(tmpDir, 'generated-hashes.txt');
        const knownHashes: Array<{ hash: string; count: number }> = [];
        for (let i = 0; i < 100; i += 1) {
          const hash = crypto.createHash('sha1').update(`password-${i}`).digest('hex').toUpperCase();
          const count = (i + 1) * 10;
          knownHashes.push({ hash, count });
        }
        knownHashes.sort((a, b) => a.hash.localeCompare(b.hash));
        fs.writeFileSync(
          hashFile,
          `${knownHashes.map((h) => `${h.hash}:${h.count}`).join('\n')}\n`,
          'ascii',
        );

        const matchingHashes = knownHashes.slice(0, 5).map((h) => h.hash);
        const nonMatchingHash = crypto.createHash('sha1').update('not-in-file').digest('hex').toUpperCase();

        const map = new Map<string, PasswordObject[]>();
        matchingHashes.forEach((h) => {
          map.set(h, [{ login_password: `pw-${h}` }]);
        });
        map.set(nonMatchingHash, [{ login_password: 'missing' }]);

        const result = await processDataLeaks(map, hashFile, 'ascii');
        expect(result).toHaveLength(5);
        result.forEach((r) => {
          expect(matchingHashes).toContain(r.hash);
          expect(r.leaks).toBeGreaterThan(0);
        });
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });
});
