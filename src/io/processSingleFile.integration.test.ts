import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  describe, it, expect, vi, afterEach,
} from 'vitest';

import type { PasswordObject } from '../types.js';
import { processSingleFile } from './processSingleFile.js';
import {
  IDX_HEADER_SIZE, IDX_PREFIX_COUNT, IDX_SORTED_FLAG_OK, NTLM_HEX_LENGTH,
  SMALL_FILE_BYTES_THRESHOLD,
} from '../constants.js';
import { FIXTURES_DIR } from '../../tests/helpers/fixturesDir.js';
import { makeMap } from '../../tests/helpers/makeMap.js';
import {
  LARGE_CORPUS_LINES_PER_PREFIX, writeLargeSha1Corpus,
} from '../../tests/helpers/largeCorpus.js';

const sha1OfPassword123 = 'E38AD214943DAAD1D64C102FAEC29DE4AFE9DA3D';
const fixturesDir = FIXTURES_DIR;

// A corpus just above the sortedness threshold (>= 1 GiB) so the index builder
// actually runs; below the threshold sortedness is `skipped` and no `.idx` is
// produced.
const LARGE_CORPUS_BYTES = SMALL_FILE_BYTES_THRESHOLD + 64 * 1024 * 1024;

describe('processSingleFile integration (real workers)', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    tmpDirs.forEach((dir) => {
      try { fs.rmSync(dir, { recursive: true }); } catch { /* ignore */ }
    });
  });

  it('parallel sequential with CHUNK_COUNT=4 — no duplicates, no misses', { timeout: 60000 }, async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psi-int-'));
    tmpDirs.push(tmpDir);

    const hashFilePath = path.join(tmpDir, 'hashes-large.txt');
    const totalLines = 10000;
    const matchPositions = [
      0,
      4999,
      9999,
    ];
    const matchHashes = [
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
    ];
    const matchPasswords = [
      'pw-first',
      'pw-middle',
      'pw-last',
    ];
    const matchLeaks = [
      10,
      20,
      30,
    ];

    const lines: string[] = [];
    for (let i = 0; i < totalLines; i += 1) {
      const pos = matchPositions.indexOf(i);
      if (pos >= 0) {
        lines.push(`${matchHashes[pos]}:${matchLeaks[pos]}`);
      } else {
        const h = i.toString(16).toUpperCase().padStart(40, '0');
        lines.push(`${h}:0`);
      }
    }
    fs.writeFileSync(hashFilePath, `${lines.join('\n')}\n`, 'ascii');

    const lookupMap = new Map<string, PasswordObject[]>();
    matchHashes.forEach((h, i) => {
      lookupMap.set(h, [{ login_password: matchPasswords[i] }]);
    });

    const savedChunkCount = process.env.CHUNK_COUNT;
    process.env.CHUNK_COUNT = '4';
    try {
      const logs: string[] = [];
      const logger = (msg: string) => { logs.push(msg); };

      const results = await processSingleFile(
        lookupMap,
        hashFilePath,
        'ascii',
        logger,
      );

      const resultMap = new Map(results.map((r) => [r.hash, r]));
      matchHashes.forEach((h, i) => {
        const r = resultMap.get(h);
        expect(r).toBeDefined();
        expect(r!.leaks).toBe(matchLeaks[i]);
        expect(r!.passwordObjects[0].login_password).toBe(matchPasswords[i]);
      });
      expect(results).toHaveLength(matchHashes.length);
      expect(logs.some((l) => l.includes('Using CHUNK_COUNT=4'))).toBe(true);
    } finally {
      if (savedChunkCount === undefined) delete process.env.CHUNK_COUNT;
      else process.env.CHUNK_COUNT = savedChunkCount;
    }
  });

  it('parallel sequential with buildIndex — .idx created from workers', { timeout: 120000 }, async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psi-int-'));
    tmpDirs.push(tmpDir);

    const hashFilePath = path.join(tmpDir, 'hashes-index.txt');
    const { matches } = writeLargeSha1Corpus(hashFilePath, LARGE_CORPUS_BYTES, [1000]);
    const matchHash = matches[0].hash;

    const lookupMap = new Map<string, PasswordObject[]>();
    lookupMap.set(matchHash, [{ login_password: 'found-it' }]);

    const savedChunkCount = process.env.CHUNK_COUNT;
    process.env.CHUNK_COUNT = '3';
    try {
      const results = await processSingleFile(
        lookupMap,
        hashFilePath,
        'ascii',
        undefined,
        undefined,
        undefined,
        'sequential',
        true,
      );

      expect(results).toHaveLength(1);
      expect(results[0].hash).toBe(matchHash);
      expect(results[0].passwordObjects[0].login_password).toBe('found-it');

      const idxPath = `${hashFilePath}.idx`;
      expect(fs.existsSync(idxPath)).toBe(true);
      const idxStat = fs.statSync(idxPath);
      const hashStat = fs.statSync(hashFilePath);
      expect(idxStat.size).toBeGreaterThan(9);
      expect(idxStat.mtimeMs).toBeGreaterThanOrEqual(hashStat.mtimeMs);
    } finally {
      if (savedChunkCount === undefined) delete process.env.CHUNK_COUNT;
      else process.env.CHUNK_COUNT = savedChunkCount;
    }
  });

  it('index mode without .idx — bootstraps index on first run, reuses on second', { timeout: 120000 }, async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psi-int-idx-bootstrap-'));
    tmpDirs.push(tmpDir);

    const hashFilePath = path.join(tmpDir, 'hashes-bootstrap.txt');
    const { matches } = writeLargeSha1Corpus(hashFilePath, LARGE_CORPUS_BYTES, [5000]);
    const matchHash = matches[0].hash;

    const lookupMap = new Map<string, PasswordObject[]>();
    lookupMap.set(matchHash, [{ login_password: 'bootstrapped' }]);

    const idxPath = `${hashFilePath}.idx`;
    expect(fs.existsSync(idxPath)).toBe(false);

    const firstLogs: string[] = [];
    const first = await processSingleFile(
      lookupMap,
      hashFilePath,
      'ascii',
      (m) => firstLogs.push(m),
      undefined,
      undefined,
      'index',
      true,
    );
    expect(first).toHaveLength(1);
    expect(first[0].passwordObjects[0].login_password).toBe('bootstrapped');
    expect(firstLogs.some((l) => l.includes('No fresh .idx found'))).toBe(true);
    expect(fs.existsSync(idxPath)).toBe(true);

    const idxBuf = fs.readFileSync(idxPath);
    // eslint-disable-next-line no-bitwise
    expect(idxBuf[0] & IDX_SORTED_FLAG_OK).toBe(IDX_SORTED_FLAG_OK);
    const idxStat = fs.statSync(idxPath);
    const hashStat = fs.statSync(hashFilePath);
    expect(idxStat.mtimeMs).toBeGreaterThanOrEqual(hashStat.mtimeMs);

    const secondLogs: string[] = [];
    const second = await processSingleFile(
      lookupMap,
      hashFilePath,
      'ascii',
      (m) => secondLogs.push(m),
      undefined,
      undefined,
      'index',
      true,
    );
    expect(second).toHaveLength(1);
    expect(second[0].passwordObjects[0].login_password).toBe('bootstrapped');
    expect(secondLogs.some((l) => l.includes('Fresh .idx found'))).toBe(true);
    expect(secondLogs.some((l) => l.includes('No fresh .idx found'))).toBe(false);
  });

  it('processes a hash file with multiple workers and returns matched results', { timeout: 60000 }, async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psi-int-'));
    tmpDirs.push(tmpDir);

    const hashFilePath = path.join(tmpDir, 'hashes.txt');
    fs.writeFileSync(
      hashFilePath,
      'E38AD214943DAAD1D64C102FAEC29DE4AFE9DA3D:5\n'
      + '0000000000000000000000000000000000000000:0\n',
      'ascii',
    );

    const lookupMap = new Map<string, PasswordObject[]>();
    lookupMap.set(sha1OfPassword123, [{ login_password: 'password123' }]);

    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };

    const results = await processSingleFile(
      lookupMap,
      hashFilePath,
      'ascii',
      logger,
      2,
    );

    expect(results).toHaveLength(1);
    expect(results[0].hash).toBe(sha1OfPassword123);
    expect(results[0].leaks).toBe(5);
    expect(results[0].passwordObjects).toHaveLength(1);
    expect(results[0].passwordObjects[0].login_password).toBe('password123');
  });

  it('parallel sequential with buildIndex — .idx binary content verified', { timeout: 120000 }, async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psi-int-idx-verify-'));
    tmpDirs.push(tmpDir);

    const hashFilePath = path.join(tmpDir, 'hashes-idx-verify.txt');
    const matchIndices = [
      1000,
      5000000,
      12000000,
      20000000,
      26000000,
    ];
    const { matches } = writeLargeSha1Corpus(
      hashFilePath,
      LARGE_CORPUS_BYTES,
      matchIndices,
    );
    const fileSize = fs.statSync(hashFilePath).size;

    const pwMap = new Map<string, PasswordObject[]>();
    matches.forEach(({ hash }) => {
      pwMap.set(hash, [{ login_password: 'idx-verify-pw' }]);
    });

    const savedChunkCount = process.env.CHUNK_COUNT;
    process.env.CHUNK_COUNT = '3';
    try {
      const results = await processSingleFile(
        pwMap,
        hashFilePath,
        'ascii',
        undefined,
        undefined,
        undefined,
        'sequential',
        true,
      );

      expect(results).toHaveLength(matches.length);

      const idxPath = `${hashFilePath}.idx`;
      expect(fs.existsSync(idxPath)).toBe(true);
      const idxBuf = fs.readFileSync(idxPath);

      const sortedFlag = idxBuf[0];
      // eslint-disable-next-line no-bitwise
      expect(sortedFlag & IDX_SORTED_FLAG_OK).toBe(IDX_SORTED_FLAG_OK);

      const lastOffset = idxBuf.readBigUInt64LE(IDX_HEADER_SIZE + IDX_PREFIX_COUNT * 8);
      expect(lastOffset).toBe(BigInt(fileSize));

      // Prefix buckets for the planted matches are distinct and ascending, so
      // their recorded offsets must be too (all within file bounds).
      let previousOffset = 0n;
      matches.forEach(({ index, hash }) => {
        const prefix = Math.floor(index / LARGE_CORPUS_LINES_PER_PREFIX);
        expect(hash.slice(0, 5)).toBe(prefix.toString(16).toUpperCase().padStart(5, '0'));
        const offset = idxBuf.readBigUInt64LE(IDX_HEADER_SIZE + prefix * 8);
        expect(offset).toBeGreaterThanOrEqual(previousOffset);
        expect(offset).toBeLessThan(BigInt(fileSize));
        previousOffset = offset;
      });
    } finally {
      if (savedChunkCount === undefined) delete process.env.CHUNK_COUNT;
      else process.env.CHUNK_COUNT = savedChunkCount;
    }
  });
});

describe('processSingleFile integration (fixture files)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns matching hashes with leak counts', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const result = await processSingleFile(
      map,
      path.join(fixturesDir, 'sample-hashes.txt'),
      'ascii',
      undefined,
      1,
    );
    expect(result).toHaveLength(1);
    expect(result[0].hash).toBe('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    expect(result[0].leaks).toBe(1000);
  });

  it('returns empty array when no hashes match', async () => {
    const map = makeMap('NONEXISTENTHASH000000000000000000000000000');
    const result = await processSingleFile(
      map,
      path.join(fixturesDir, 'sample-hashes.txt'),
      'ascii',
      undefined,
      1,
    );
    expect(result).toHaveLength(0);
  });

  it('skips invalid line in hashes file', async () => {
    const map = makeMap('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
    const result = await processSingleFile(
      map,
      path.join(fixturesDir, 'invalid-hashes.txt'),
      'ascii',
      undefined,
      1,
    );
    expect(result).toHaveLength(0);
  });

  it('returns empty array for empty hash file', async () => {
    const map = makeMap('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
    const result = await processSingleFile(
      map,
      path.join(fixturesDir, 'empty-hashes.txt'),
      'ascii',
      undefined,
      1,
    );
    expect(result).toHaveLength(0);
  });

  it('calls onProgress callback during single chunk processing', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const onProgress = vi.fn();

    const result = await processSingleFile(
      map,
      path.join(fixturesDir, 'sample-hashes.txt'),
      'ascii',
      undefined,
      1,
      onProgress,
    );

    expect(result).toHaveLength(1);
    expect(result[0].leaks).toBe(1000);
    expect(onProgress).toHaveBeenCalled();
    const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1][0];
    expect(lastCall.current).toBeGreaterThan(0);
    expect(lastCall.total).toBeGreaterThan(0);
  });

  it('skips invalid data in partial line at end of file', async () => {
    const map = makeMap('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
    const result = await processSingleFile(
      map,
      path.join(fixturesDir, 'partial-line-error-hashes.txt'),
      'ascii',
      undefined,
      1,
    );
    expect(result).toHaveLength(0);
  });

  it('handles file without trailing newline', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const result = await processSingleFile(
      map,
      path.join(fixturesDir, 'no-trailing-newline-hashes.txt'),
      'ascii',
      undefined,
      1,
    );
    expect(result).toHaveLength(1);
    expect(result[0].leaks).toBe(1000);
  });

  it('rejects on error during stream read (permission denied)', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-stream-error-'));
    const tempFile = path.join(tempDir, 'unreadable.txt');
    fs.writeFileSync(tempFile, 'anything');
    fs.chmodSync(tempFile, 0o000);
    const map = makeMap('SOMETHING');
    try {
      await expect(processSingleFile(map, tempFile, 'ascii', undefined, 1)).rejects.toThrow();
    } finally {
      fs.chmodSync(tempFile, 0o644);
      fs.unlinkSync(tempFile);
      fs.rmdirSync(tempDir);
    }
  });

  it('processes file with 2 chunks without duplicates or misses', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-concurrent-'));
    const tempFile = path.join(tempDir, 'hashes.txt');
    try {
      const h1 = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';
      const h2 = 'B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3';
      const h3 = '076D3E6C4B9F654B5B220B9045B7458AB6B4CBC6';
      const h4 = 'A7C65B8E8A6C5D0E4F3A2B1C9D8E7F6A5B4C3D2E';

      const content = `${h1}:100\n${h2}:200\n${h3}:300\n${h4}:400`;
      fs.writeFileSync(tempFile, content, 'ascii');

      const map = new Map<string, PasswordObject[]>();
      map.set(h1, [{ login_password: 'p1' }]);
      map.set(h2, [{ login_password: 'p2' }]);
      map.set(h3, [{ login_password: 'p3' }]);
      map.set(h4, [{ login_password: 'p4' }]);

      const result = await processSingleFile(map, tempFile, 'ascii', undefined, 2);
      expect(result).toHaveLength(4);
      const hashes = result.map((r) => r.hash);
      expect(hashes).toContain(h1);
      expect(hashes).toContain(h2);
      expect(hashes).toContain(h3);
      expect(hashes).toContain(h4);
    } finally {
      try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
      try { fs.rmdirSync(tempDir); } catch { /* ignore */ }
    }
  });

  it('returns empty array with 2 chunks on empty file', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-concurrent-empty-'));
    const tempFile = path.join(tempDir, 'empty.txt');
    try {
      fs.writeFileSync(tempFile, '', 'ascii');

      const map = new Map<string, PasswordObject[]>();
      const result = await processSingleFile(map, tempFile, 'ascii', undefined, 2);
      expect(result).toHaveLength(0);
    } finally {
      try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
      try { fs.rmdirSync(tempDir); } catch { /* ignore */ }
    }
  });

  it('skips invalid hash data in concurrent chunk', async () => {
    const map = makeMap('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
    const result = await processSingleFile(
      map,
      path.join(fixturesDir, 'invalid-hashes.txt'),
      'ascii',
      undefined,
      2,
    );
    expect(result).toHaveLength(0);
  });

  it('calls onProgress with workers count during concurrent chunks', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conc-log-'));
    const tempFile = path.join(tempDir, 'hashes.txt');
    try {
      const h1 = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';
      const h2 = 'B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3';
      fs.writeFileSync(tempFile, `${h1}:100\n${h2}:200\n`, 'ascii');
      const map = new Map<string, PasswordObject[]>();
      map.set(h1, [{ login_password: 'p1' }]);
      map.set(h2, [{ login_password: 'p2' }]);
      const onProgress = vi.fn();
      await processSingleFile(map, tempFile, 'ascii', undefined, 2, onProgress);
      expect(onProgress).toHaveBeenCalled();
      const workersCalls = onProgress.mock.calls.filter(
        (c: unknown[]) => c[0].workers !== undefined,
      );
      expect(workersCalls.length).toBeGreaterThan(0);
    } finally {
      try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
      try { fs.rmdirSync(tempDir); } catch { /* ignore */ }
    }
  });

  it('warns when overlapping chunks have differing leak counts for same hash', async () => {
    const h1 = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';
    const h2 = 'B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3';
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-dedup-warn-'));
    const tempFile = path.join(tempDir, 'hashes.txt');
    try {
      fs.writeFileSync(tempFile, `${h1}:100\n${h2}:200\n${h1}:300\n`, 'ascii');
      const map = new Map<string, PasswordObject[]>();
      map.set(h1, [{ login_password: 'p1' }]);
      map.set(h2, [{ login_password: 'p2' }]);
      const logs: string[] = [];
      const logger = (msg: string) => { logs.push(msg); };
      await processSingleFile(map, tempFile, 'ascii', logger, 2);
      expect(logs.some((l) => l.includes('differing leak counts'))).toBe(true);
    } finally {
      try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
      try { fs.rmdirSync(tempDir); } catch { /* ignore */ }
    }
  });
});

describe('processSingleFile NTLM single-file (real workers)', () => {
  const ntlmCorpus = path.join(fixturesDir, 'ntlm-hashes.txt');

  function ntlmMap(): Map<string, PasswordObject[]> {
    const map = new Map<string, PasswordObject[]>();
    map.set('8846F7EAEE8FB117AD06BDD830B7586C', [{ login_password: 'password' }]);
    map.set('32ED87BDB5FDC5E9CBA88547376818D4', [{ login_password: '123456' }]);
    map.set('BECEDB42EC3C5C7F965255338BE4453C', [{ login_password: 'letmein' }]);
    map.set('00000000000000000000000000000000', [{ login_password: 'not-leaked' }]);
    return map;
  }

  it('reports every planted NTLM password with the correct count', { timeout: 60000 }, async () => {
    const results = await processSingleFile(
      ntlmMap(),
      ntlmCorpus,
      'ascii',
      undefined,
      undefined,
      undefined,
      'auto',
      false,
      NTLM_HEX_LENGTH,
    );

    const byHash = new Map(results.map((r) => [r.hash, r]));
    expect(byHash.get('8846F7EAEE8FB117AD06BDD830B7586C')?.leaks).toBe(99999);
    expect(byHash.get('32ED87BDB5FDC5E9CBA88547376818D4')?.leaks).toBe(37281043);
    expect(byHash.get('BECEDB42EC3C5C7F965255338BE4453C')?.leaks).toBe(250000);
    expect(byHash.has('00000000000000000000000000000000')).toBe(false);
  });

  it('does not match SHA-1 hashes of the same passwords in NTLM mode', { timeout: 60000 }, async () => {
    const map = new Map<string, PasswordObject[]>();
    // SHA-1 of "password123" is present in the SHA-1 fixture, not the NTLM one.
    map.set('E38AD214943DAAD1D64C102FAEC29DE4AFE9DA3D', [{ login_password: 'password123' }]);
    const results = await processSingleFile(map, ntlmCorpus, 'ascii', undefined, undefined, undefined, 'auto', false, NTLM_HEX_LENGTH);
    expect(results).toHaveLength(0);
  });
});
