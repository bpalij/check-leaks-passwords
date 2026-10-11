import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  describe, it, expect, afterEach, vi,
} from 'vitest';

import { processSingleFile } from './processSingleFile.js';
import { binarySearchReader } from './readModes/binarySearch.js';
import { indexReader } from './readModes/indexBased.js';
import { determineOptimalChunkCount } from '../memory/determineOptimalChunkCount.js';
import { detectSortedness } from '../hashing/detectSortedness.js';
import { IDX_HEADER_SIZE, IDX_PREFIX_COUNT } from '../constants.js';
import { FIXTURES_DIR } from '../../tests/helpers/fixturesDir.js';
import { buildHashLookupMap } from '../hashing/buildLookupMap.js';
import { makeLookupMap } from '../../tests/helpers/makeLookupMap.js';

function loadIdx(idxPath: string): BigUint64Array {
  const idxFile = fs.readFileSync(idxPath);
  const arr = new BigUint64Array(IDX_PREFIX_COUNT + 1);
  for (let i = 0; i <= IDX_PREFIX_COUNT; i += 1) {
    arr[i] = idxFile.readBigUInt64LE(IDX_HEADER_SIZE + i * 8);
  }
  return arr;
}

const FIXTURE_PATH = path.join(FIXTURES_DIR, 'sorted-hashes.txt');
const FIXTURE_HASHES = fs.readFileSync(FIXTURE_PATH, 'utf-8')
  .trim().split('\n')
  .map((line) => line.split(':')[0]);

const MATCH_HASHES = [
  FIXTURE_HASHES[0],
  FIXTURE_HASHES[2],
  FIXTURE_HASHES[4],
];
const MATCH_PASSWORDS = [
  'pw0',
  'pw2',
  'pw4',
];

const NON_EXISTENT_HASH = 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF';

describe('integration readers — real file I/O', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    tmpDirs.forEach((dir) => {
      try { fs.rmSync(dir, { recursive: true }); } catch { /* ignore */ }
    });
    tmpDirs.length = 0;
    try { fs.unlinkSync(`${FIXTURE_PATH}.idx`); } catch { /* ignore */ }
  });

  function makeTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-int-'));
    tmpDirs.push(dir);
    return dir;
  }

  it('binarySearchReader — real file I/O', { timeout: 30000 }, async () => {
    const { map, set, pwMap } = makeLookupMap(MATCH_HASHES, MATCH_PASSWORDS);
    const stat = fs.statSync(FIXTURE_PATH);

    const results = await binarySearchReader(
      FIXTURE_PATH,
      stat.size,
      map,
      set,
      'ascii',
      pwMap,
    );

    expect(results).toHaveLength(MATCH_HASHES.length);
    const resultMap = new Map(results.map((r) => [r.hash, r]));
    MATCH_HASHES.forEach((h, i) => {
      const r = resultMap.get(h);
      expect(r).toBeDefined();
      expect(r!.passwordObjects[0].login_password).toBe(MATCH_PASSWORDS[i]);
    });
  });

  it('binarySearchReader — non-matching hashes return empty', async () => {
    const fakePwMap = new Map<string, PasswordObject[]>();
    fakePwMap.set(NON_EXISTENT_HASH, [{ login_password: 'nope' }]);
    const { map, set } = buildHashLookupMap(fakePwMap);
    const stat = fs.statSync(FIXTURE_PATH);

    const results = await binarySearchReader(
      FIXTURE_PATH,
      stat.size,
      map,
      set,
      'ascii',
      fakePwMap,
    );

    expect(results).toHaveLength(0);
  });

  it('indexReader — real file I/O', { timeout: 60000 }, async () => {
    const pwMap = new Map<string, PasswordObject[]>();
    MATCH_HASHES.forEach((h, i) => {
      pwMap.set(h, [{ login_password: MATCH_PASSWORDS[i] }]);
    });

    await processSingleFile(pwMap, FIXTURE_PATH, 'ascii', undefined, undefined, undefined, 'auto', true);
    const idxPath = `${FIXTURE_PATH}.idx`;
    expect(fs.existsSync(idxPath)).toBe(true);
    const idx = loadIdx(idxPath);

    const { map, set } = makeLookupMap(MATCH_HASHES, MATCH_PASSWORDS);
    const stat = fs.statSync(FIXTURE_PATH);

    const results = await indexReader(
      FIXTURE_PATH,
      stat.size,
      map,
      set,
      'ascii',
      idx,
      pwMap,
    );

    expect(results).toHaveLength(MATCH_HASHES.length);
    const resultMap = new Map(results.map((r) => [r.hash, r]));
    MATCH_HASHES.forEach((h, i) => {
      const r = resultMap.get(h);
      expect(r).toBeDefined();
      expect(r!.passwordObjects[0].login_password).toBe(MATCH_PASSWORDS[i]);
    });
  });

  it('processSingleFile — forced binary via env var', { timeout: 30000 }, async () => {
    const pwMap = new Map<string, PasswordObject[]>();
    MATCH_HASHES.forEach((h, i) => {
      pwMap.set(h, [{ login_password: MATCH_PASSWORDS[i] }]);
    });

    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };

    const savedEnv = process.env.READ_MODE_FORCED;
    process.env.READ_MODE_FORCED = 'binary';
    try {
      const results = await processSingleFile(
        pwMap,
        FIXTURE_PATH,
        'ascii',
        logger,
      );

      expect(results).toHaveLength(MATCH_HASHES.length);
      expect(logs.some((l) => l.includes('Binary search'))).toBe(true);
    } finally {
      if (savedEnv === undefined) delete process.env.READ_MODE_FORCED;
      else process.env.READ_MODE_FORCED = savedEnv;
    }
  });

  it('processSingleFile — forced index via env var', { timeout: 60000 }, async () => {
    const pwMap = new Map<string, PasswordObject[]>();
    MATCH_HASHES.forEach((h, i) => {
      pwMap.set(h, [{ login_password: MATCH_PASSWORDS[i] }]);
    });

    await processSingleFile(pwMap, FIXTURE_PATH, 'ascii', undefined, undefined, undefined, 'auto', true);
    const idxPath = `${FIXTURE_PATH}.idx`;
    expect(fs.existsSync(idxPath)).toBe(true);
    const idxStat = fs.statSync(idxPath);
    const fileStat = fs.statSync(FIXTURE_PATH);
    expect(idxStat.mtimeMs).toBeGreaterThan(fileStat.mtimeMs);

    const indexLogs: string[] = [];
    const indexLogger = (msg: string) => { indexLogs.push(msg); };

    const savedEnv = process.env.READ_MODE_FORCED;
    process.env.READ_MODE_FORCED = 'index';
    try {
      const results = await processSingleFile(
        pwMap,
        FIXTURE_PATH,
        'ascii',
        indexLogger,
      );

      expect(results).toHaveLength(MATCH_HASHES.length);
      expect(indexLogs.some((l) => l.includes('Index read'))).toBe(true);
    } finally {
      if (savedEnv === undefined) delete process.env.READ_MODE_FORCED;
      else process.env.READ_MODE_FORCED = savedEnv;
    }
  });

  it('fingerprintDense — >16384 entries skips set serialization', { timeout: 60000 }, async () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, 'hashes.txt');

    const diverseHashes: string[] = [];
    const diversePasswords: string[] = [];
    for (let i = 0; i < 20000; i += 1) {
      const first4hex = i.toString(16).toUpperCase().padStart(4, '0');
      diverseHashes.push(`${first4hex}${'0'.repeat(36)}`);
      diversePasswords.push(`pw-${i}`);
    }

    const lines = diverseHashes.map((h, i) => `${h}:${10 + i}`);
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'ascii');

    const pwMap = new Map<string, PasswordObject[]>();
    diverseHashes.forEach((h, i) => {
      pwMap.set(h, [{ login_password: diversePasswords[i] }]);
    });

    const stdoutChunks: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
      return true;
    });

    try {
      await processSingleFile(pwMap, filePath, 'ascii', () => {});

      const joined = stdoutChunks.join('');
      expect(joined).toContain('set: skipped (dense)');
    } finally {
      spy.mockRestore();
    }
  });

  it('determineOptimalChunkCount — real speed test on small file via SPEED_TEST_MIN_BYTES', { timeout: 30000 }, async () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, 'speed-test-hashes.txt');

    const totalLines = 500;
    const lines: string[] = [];
    for (let i = 0; i < totalLines; i += 1) {
      const h = i.toString(16).toUpperCase().padStart(40, '0');
      lines.push(`${h}:${10 + i}`);
    }
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'ascii');

    const savedThreshold = process.env.SPEED_TEST_MIN_BYTES;
    process.env.SPEED_TEST_MIN_BYTES = '0';
    try {
      const stat = fs.statSync(filePath);
      const result = await determineOptimalChunkCount(filePath, stat.size);

      expect(result.preCheckSkipped).toBe(false);
      expect(result.iopMBps).toBeGreaterThan(0);
      expect(result.testDurationMs).toBeGreaterThan(0);
      expect(result.chunkCount).toBeGreaterThanOrEqual(1);
    } finally {
      if (savedThreshold === undefined) delete process.env.SPEED_TEST_MIN_BYTES;
      else process.env.SPEED_TEST_MIN_BYTES = savedThreshold;
    }
  });

  it('evaluateReadMode uses real speed data — not synthetic defaults', { timeout: 30000 }, async () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, 'eval-hashes.txt');

    const matchHash = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const totalLines = 500;
    const lines: string[] = [];
    for (let i = 0; i < totalLines; i += 1) {
      if (i === 250) {
        lines.push(`${matchHash}:42`);
      } else {
        const h = i.toString(16).toUpperCase().padStart(40, '0');
        lines.push(`${h}:0`);
      }
    }
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'ascii');

    const pwMap = new Map<string, PasswordObject[]>();
    pwMap.set(matchHash, [{ login_password: 'real-speed-pw' }]);

    const savedThreshold = process.env.SPEED_TEST_MIN_BYTES;
    process.env.SPEED_TEST_MIN_BYTES = '0';
    try {
      const logs: string[] = [];
      const logger = (msg: string) => { logs.push(msg); };

      const results = await processSingleFile(pwMap, filePath, 'ascii', logger);

      expect(results).toHaveLength(1);
      expect(results[0].hash).toBe(matchHash);

      const hasDriveSpeedLog = logs.some((l) => l.includes('Drive speed:'));
      const hasHDDLog = logs.some((l) => l.includes('HDD detected'));
      const hasSkippedLog = logs.some((l) => l.includes('File <1 GB'));
      expect(hasDriveSpeedLog || hasHDDLog || hasSkippedLog).toBe(true);
    } finally {
      if (savedThreshold === undefined) delete process.env.SPEED_TEST_MIN_BYTES;
      else process.env.SPEED_TEST_MIN_BYTES = savedThreshold;
    }
  });

  it('detectSortedness — reads .idx cache built by previous run', { timeout: 60000 }, async () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, 'sorted-cache-hashes.txt');

    const totalLines = 500;
    const lines: string[] = [];
    for (let i = 0; i < totalLines; i += 1) {
      const h = i.toString(16).toUpperCase().padStart(40, '0');
      lines.push(`${h}:${10 + i}`);
    }
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'ascii');

    const pwMap = new Map<string, PasswordObject[]>();

    await processSingleFile(pwMap, filePath, 'ascii', undefined, undefined, undefined, 'auto', true);
    const idxPath = `${filePath}.idx`;
    expect(fs.existsSync(idxPath)).toBe(true);

    const sortednessWithoutCache = await detectSortedness(filePath);
    expect(sortednessWithoutCache).toBe(true);

    const idxStat = fs.statSync(idxPath);
    const fileStat = fs.statSync(filePath);
    expect(idxStat.mtimeMs).toBeGreaterThanOrEqual(fileStat.mtimeMs);
  });

  it('processChunk multi-buffer — real fd read across 16MB buffer boundary', { timeout: 120000 }, async () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, 'multibuf-hashes.txt');

    const matchHashes = [
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
    ];
    const matchPasswords = [
      'mb-pw-a',
      'mb-pw-b',
      'mb-pw-c',
    ];

    const totalLines = 400000;
    const matchLineCount = 3;
    const matchInterval = Math.floor(totalLines / (matchLineCount + 1));
    const matchLines = matchHashes.map((h, i) => ({
      lineIndex: matchInterval * (i + 1),
      hash: h,
      leaks: (i + 1) * 100,
    }));

    const writeStream = fs.createWriteStream(filePath, { encoding: 'ascii' });
    for (let i = 0; i < totalLines; i += 1) {
      const match = matchLines.find((m) => m.lineIndex === i);
      if (match) {
        writeStream.write(`${match.hash}:${match.leaks}\n`);
      } else {
        const h = i.toString(16).toUpperCase().padStart(40, '0');
        writeStream.write(`${h}:0\n`);
      }
    }
    writeStream.end();
    await new Promise<void>((resolve) => { writeStream.on('finish', resolve); });

    const fileSize = fs.statSync(filePath).size;
    expect(fileSize).toBeGreaterThan(16 * 1024 * 1024);

    const pwMap = new Map<string, PasswordObject[]>();
    matchHashes.forEach((h, i) => {
      pwMap.set(h, [{ login_password: matchPasswords[i] }]);
    });

    const savedChunkCount = process.env.CHUNK_COUNT;
    process.env.CHUNK_COUNT = '2';
    try {
      const results = await processSingleFile(pwMap, filePath, 'ascii');

      const resultMap = new Map(results.map((r) => [r.hash, r]));
      matchHashes.forEach((h, i) => {
        const r = resultMap.get(h);
        expect(r).toBeDefined();
        expect(r!.leaks).toBe(matchLines[i].leaks);
        expect(r!.passwordObjects[0].login_password).toBe(matchPasswords[i]);
      });
      expect(results).toHaveLength(matchHashes.length);
    } finally {
      if (savedChunkCount === undefined) delete process.env.CHUNK_COUNT;
      else process.env.CHUNK_COUNT = savedChunkCount;
    }
  });

  it('binarySearchReader — concurrent coalesced reads with many hashes', { timeout: 60000 }, async () => {
    const dir = makeTmpDir();
    const filePath = path.join(dir, 'bs-many-hashes.txt');

    const totalLines = 5000;
    const searchCount = 500;
    const searchStep = Math.floor(totalLines / searchCount);
    const searchHashes: string[] = [];
    const searchPasswords: string[] = [];
    const lines: string[] = [];
    for (let i = 0; i < totalLines; i += 1) {
      const h = i.toString(16).toUpperCase().padStart(40, '0');
      const leaks = 10 + i;
      lines.push(`${h}:${leaks}`);
      if (i % searchStep === 0 && searchHashes.length < searchCount) {
        searchHashes.push(h);
        searchPasswords.push(`bs-pw-${searchHashes.length}`);
      }
    }
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'ascii');
    const fileSize = fs.statSync(filePath).size;

    const pwMap = new Map<string, PasswordObject[]>();
    searchHashes.forEach((h, i) => {
      pwMap.set(h, [{ login_password: searchPasswords[i] }]);
    });
    const { map, set } = buildHashLookupMap(pwMap);

    const results = await binarySearchReader(
      filePath,
      fileSize,
      map,
      set,
      'ascii',
      pwMap,
    );

    expect(results.length).toBeGreaterThanOrEqual(searchCount * 0.9);
    const resultMap = new Map(results.map((r) => [r.hash, r]));
    searchHashes.forEach((h) => {
      const r = resultMap.get(h);
      expect(r).toBeDefined();
      expect(r!.leaks).toBeGreaterThanOrEqual(10);
    });
  });
});
