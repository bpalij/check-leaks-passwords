import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  describe, it, expect, vi, afterEach,
} from 'vitest';

import type { PasswordObject } from '../types.js';
import { processSingleFile } from './processSingleFile.js';
import { IDX_HEADER_SIZE, IDX_PREFIX_COUNT, IDX_SORTED_FLAG_OK } from '../constants.js';
import { FIXTURES_DIR } from '../../tests/helpers/fixturesDir.js';
import { makeMap } from '../../tests/helpers/makeMap.js';

const sha1OfPassword123 = 'E38AD214943DAAD1D64C102FAEC29DE4AFE9DA3D';
const fixturesDir = FIXTURES_DIR;

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

  it('parallel sequential with buildIndex — .idx created from workers', { timeout: 60000 }, async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psi-int-'));
    tmpDirs.push(tmpDir);

    const hashFilePath = path.join(tmpDir, 'hashes-index.txt');
    const totalLines = 5000;
    const matchHash = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const lines: string[] = [];
    for (let i = 0; i < totalLines; i += 1) {
      // Sorted ascending: a .idx is only built for sorted input
      if (i === totalLines - 1) {
        lines.push(`${matchHash}:42`);
      } else {
        const h = (i + 1).toString(16).toUpperCase().padStart(40, '0');
        lines.push(`${h}:0`);
      }
    }
    fs.writeFileSync(hashFilePath, `${lines.join('\n')}\n`, 'ascii');

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
        'auto',
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
    const totalLines = 5000;
    const matchHash = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const lines: string[] = [];
    for (let i = 0; i < totalLines; i += 1) {
      // Sorted ascending: a .idx is only built for sorted input
      if (i === totalLines - 1) {
        lines.push(`${matchHash}:42`);
      } else {
        const h = (i + 1).toString(16).toUpperCase().padStart(40, '0');
        lines.push(`${h}:0`);
      }
    }
    fs.writeFileSync(hashFilePath, `${lines.join('\n')}\n`, 'ascii');

    const lookupMap = new Map<string, PasswordObject[]>();
    lookupMap.set(matchHash, [{ login_password: 'bootstrapped' }]);

    // Force the drive speed test on this small file so the run reaches the
    // index-mode decision (preCheckSkipped=false); otherwise the small-file
    // fast path would handle the scan before mode selection.
    const savedThreshold = process.env.SPEED_TEST_MIN_BYTES;
    process.env.SPEED_TEST_MIN_BYTES = '0';
    try {
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
    } finally {
      if (savedThreshold === undefined) delete process.env.SPEED_TEST_MIN_BYTES;
      else process.env.SPEED_TEST_MIN_BYTES = savedThreshold;
    }
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

  it('parallel sequential with buildIndex — .idx binary content verified', { timeout: 60000 }, async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psi-int-idx-verify-'));
    tmpDirs.push(tmpDir);

    const hashFilePath = path.join(tmpDir, 'hashes-idx-verify.txt');
    const totalLines = 2000;
    const matchIndices = [
      256,
      600,
      1200,
      1600,
      1999,
    ];
    const matchHashes = matchIndices.map(
      (i) => `${i.toString(16).toUpperCase().padStart(5, '0')}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
    );
    const lines: string[] = [];
    for (let i = 0; i < totalLines; i += 1) {
      const h = `${i.toString(16).toUpperCase().padStart(5, '0')}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
      lines.push(`${h}:0`);
    }
    matchHashes.forEach((h) => {
      const idx = lines.findIndex((l) => l.startsWith(h));
      if (idx >= 0) lines[idx] = `${h}:99`;
    });
    lines.sort((a, b) => a.localeCompare(b));
    fs.writeFileSync(hashFilePath, `${lines.join('\n')}\n`, 'ascii');
    const fileSize = fs.statSync(hashFilePath).size;

    const pwMap = new Map<string, PasswordObject[]>();
    matchHashes.forEach((h) => {
      pwMap.set(h, [{ login_password: 'idx-verify-pw' }]);
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
        'auto',
        true,
      );

      expect(results).toHaveLength(matchHashes.length);

      const idxPath = `${hashFilePath}.idx`;
      expect(fs.existsSync(idxPath)).toBe(true);
      const idxBuf = fs.readFileSync(idxPath);

      const sortedFlag = idxBuf[0];
      // eslint-disable-next-line no-bitwise
      expect(sortedFlag & IDX_SORTED_FLAG_OK).toBe(IDX_SORTED_FLAG_OK);

      const lastOffset = idxBuf.readBigUInt64LE(IDX_HEADER_SIZE + IDX_PREFIX_COUNT * 8);
      expect(lastOffset).toBe(BigInt(fileSize));

      const firstPrefix = matchIndices[0];
      const firstOffset = idxBuf.readBigUInt64LE(IDX_HEADER_SIZE + firstPrefix * 8);
      expect(firstOffset).toBeGreaterThanOrEqual(0n);
      expect(firstOffset).toBeLessThan(BigInt(fileSize));

      const midPrefix = matchIndices[2];
      const midOffset = idxBuf.readBigUInt64LE(IDX_HEADER_SIZE + midPrefix * 8);
      expect(midOffset).toBeGreaterThanOrEqual(firstOffset);

      const lastPrefix = matchIndices[4];
      const lastPrefixOffset = idxBuf.readBigUInt64LE(IDX_HEADER_SIZE + lastPrefix * 8);
      expect(lastPrefixOffset).toBeGreaterThanOrEqual(midOffset);
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
