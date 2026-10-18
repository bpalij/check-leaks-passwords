import path from 'path';
import fs from 'fs';

import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

import { IDX_PREFIX_COUNT } from '../../constants';
import { indexReader } from './indexBased';
import { FIXTURES_DIR } from '../../../tests/helpers/fixturesDir.js';
import { ntlm } from '../../../tests/helpers/ntlm.js';
import { makeSortedCorpus } from '../../../tests/helpers/hashCases.js';
import { makeTestFilePath } from '../../../tests/helpers/testTmp.js';

vi.mock('../../memory/getAvailableMemBytes.js', () => ({ getAvailableMemBytes: () => 1024 * 1024 * 1024 }));

/**
 * Build a sorted 32-char corpus plus a matching `.idx` offset table.
 *
 * @param pairs - `[hash, leakCount]` entries to write to the corpus.
 * @returns The corpus text and the parallel `.idx` offset table.
 */
function buildNtlmFixture(
  pairs: Array<[string, number]>,
): { content: string; idx: BigUint64Array } {
  const content = makeSortedCorpus(pairs);
  const idx = new BigUint64Array(IDX_PREFIX_COUNT + 1);
  let offset = 0;
  content.split('\n').forEach((line) => {
    if (line === '') return;
    const prefix = parseInt(line.slice(0, 5), 16);
    const lineLen = Buffer.byteLength(line, 'ascii') + 1; // include newline
    idx[prefix] = BigInt(offset);
    idx[prefix + 1] = BigInt(offset + lineLen);
    offset += lineLen;
  });
  return { content, idx };
}

const filePath = path.join(FIXTURES_DIR, 'binary-sorted-hashes.txt');
const fileSize = 2103;

// Prefixes from the fixture file
const PREFIX_A = 0xA0000; // 655360, offset 0
const PREFIX_C = 0xC0000; // 786432, offset 86
const PREFIX_F = 0xF0000; // 983040, offset 215-343 (3 lines)

const HASH_A = 'A000000000000000000000000000000000000000';
const HASH_C = 'C000000000000000000001000000000000000000';
const HASH_F0 = 'F000000000000000000000000000000000000000';
const HASH_NONE = '0000000000000000000000000000000000000000';

function buildIdx(): BigUint64Array {
  const idx = new BigUint64Array(IDX_PREFIX_COUNT + 1);
  // A0000... at offset 0-42
  idx[PREFIX_A] = BigInt(0);
  idx[PREFIX_A + 1] = BigInt(43);
  // C0000... at offset 86-128
  idx[PREFIX_C] = BigInt(86);
  idx[PREFIX_C + 1] = BigInt(129);
  // F0000... at offsets 215-343 (lines 6,7,8)
  idx[PREFIX_F] = BigInt(215);
  idx[PREFIX_F + 1] = BigInt(344);
  return idx;
}

function makeArgs(hash: string) {
  const pwMap = new Map<string, Array<{ login_password: string }>>();
  pwMap.set(hash, [{ login_password: 'pass' }]);
  return pwMap;
}

function buildLookupMap(hash: string) {
  const map = new Map<number, Array<{ fullHash: string; fullHashBytes: Buffer }>>();
  const key1 = Buffer.from(hash, 'ascii').readUInt32BE(0);
  map.set(key1, [{ fullHash: hash, fullHashBytes: Buffer.from(hash, 'ascii') }]);
  return map;
}

describe('indexReader', () => {
  const idx = buildIdx();
  const encoding = 'ascii';

  beforeEach(() => {
    delete process.env.INDEX_READER_CONCURRENCY;
  });

  it('finds hash at start of file', async () => {
    const pwMap = makeArgs(HASH_A);
    const map = buildLookupMap(HASH_A);
    const out = await indexReader(filePath, fileSize, map, null, encoding, idx, pwMap);
    expect(out).toHaveLength(1);
    expect(out[0].hash).toBe(HASH_A);
  });

  it('finds hash in middle of file', async () => {
    const pwMap = makeArgs(HASH_C);
    const map = buildLookupMap(HASH_C);
    const out = await indexReader(filePath, fileSize, map, null, encoding, idx, pwMap);
    expect(out).toHaveLength(1);
    expect(out[0].hash).toBe(HASH_C);
  });

  it('finds hash from prefix with multiple entries', async () => {
    const pwMap = makeArgs(HASH_F0);
    const map = buildLookupMap(HASH_F0);
    const out = await indexReader(filePath, fileSize, map, null, encoding, idx, pwMap);
    expect(out).toHaveLength(1);
    expect(out[0].hash).toBe(HASH_F0);
  });

  it('returns empty for non-matching hash', async () => {
    const pwMap = makeArgs(HASH_NONE);
    const map = buildLookupMap(HASH_NONE);
    const out = await indexReader(filePath, fileSize, map, null, encoding, idx, pwMap);
    expect(out).toHaveLength(0);
  });

  it('calls logger', async () => {
    const pwMap = makeArgs(HASH_A);
    const map = buildLookupMap(HASH_A);
    const logs: string[] = [];
    await indexReader(
      filePath,
      fileSize,
      map,
      null,
      encoding,
      idx,
      pwMap,
      (m) => { logs.push(m); },
    );
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs.some((l) => l.includes('Found'))).toBe(true);
  });

  it('sorts ranges and logs HDD message when HDD detected', async () => {
    const pwMap = makeArgs(HASH_A);
    const map = buildLookupMap(HASH_A);
    const logs: string[] = [];
    const out = await indexReader(
      filePath,
      fileSize,
      map,
      null,
      encoding,
      idx,
      pwMap,
      (m) => { logs.push(m); },
      undefined,
      true,
    );
    expect(out).toHaveLength(1);
    expect(out[0].hash).toBe(HASH_A);
    expect(logs.some((l) => l.includes('HDD detected, using 1 worker'))).toBe(true);
  });

  it('uses maxConcurrency=1 on HDD', async () => {
    const pwMap = makeArgs(HASH_A);
    const map = buildLookupMap(HASH_A);
    const logs: string[] = [];
    await indexReader(
      filePath,
      fileSize,
      map,
      null,
      encoding,
      idx,
      pwMap,
      (m) => { logs.push(m); },
      undefined,
      true,
    );
    expect(logs.some((l) => l.includes('HDD detected, using 1 worker'))).toBe(true);
    expect(logs.some((l) => l.includes('SSD/NVMe'))).toBe(false);
  });

  it('respects INDEX_READER_CONCURRENCY env var', async () => {
    process.env.INDEX_READER_CONCURRENCY = '4';
    const pwMap = makeArgs(HASH_A);
    const map = buildLookupMap(HASH_A);
    const out = await indexReader(filePath, fileSize, map, null, encoding, idx, pwMap);
    expect(out).toHaveLength(1);
    expect(out[0].hash).toBe(HASH_A);
  });

  it('ignores invalid INDEX_READER_CONCURRENCY env var', async () => {
    process.env.INDEX_READER_CONCURRENCY = 'abc';
    const pwMap = makeArgs(HASH_A);
    const map = buildLookupMap(HASH_A);
    const out = await indexReader(filePath, fileSize, map, null, encoding, idx, pwMap);
    expect(out).toHaveLength(1);
    expect(out[0].hash).toBe(HASH_A);
  });

  it('HDD with logger covers all HDD log paths', async () => {
    const pwMap = makeArgs(HASH_A);
    const map = buildLookupMap(HASH_A);
    const logs: string[] = [];
    await indexReader(
      filePath,
      fileSize,
      map,
      null,
      encoding,
      idx,
      pwMap,
      (m) => { logs.push(m); },
      undefined,
      true,
    );
    expect(logs.some((l) => l.includes('Index read: reading'))).toBe(true);
    expect(logs.some((l) => l.includes('HDD detected, using 1 worker'))).toBe(true);
    expect(logs.some((l) => l.includes('Index read complete'))).toBe(true);
  });

  it('finds 32-char NTLM hashes when fullHashLength=32', async () => {
    const vectors: Array<[string, number]> = [
      [ntlm('password'), 99999],
      [ntlm('123456'), 37281043],
      [ntlm('letmein'), 250000],
      [ntlm('password123'), 1000],
    ];
    const { content, idx: ntlmIdx } = buildNtlmFixture(vectors);
    const tmpFile = makeTestFilePath(`idx-ntlm-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, content, 'ascii');

    const map = new Map<number, Array<{ fullHash: string; fullHashBytes: Buffer }>>();
    const pwMap = new Map<string, Array<{ login_password: string }>>();
    vectors.forEach(([hash]) => {
      pwMap.set(hash, [{ login_password: 'pw' }]);
      const key = Buffer.from(hash, 'ascii').readUInt32BE(0);
      map.set(key, [{ fullHash: hash, fullHashBytes: Buffer.from(hash, 'ascii').subarray(0, 32) }]);
    });

    try {
      const out = await indexReader(tmpFile, content.length, map, null, 'ascii', ntlmIdx, pwMap, undefined, undefined, false, 32);
      expect(out).toHaveLength(vectors.length);
      const byHash = new Map(out.map((r) => [r.hash, r.leaks]));
      vectors.forEach(([hash, count]) => {
        expect(byHash.get(hash)).toBe(count);
      });
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('does not match 32-char NTLM hashes when fullHashLength is not threaded (default 40)', async () => {
    const vectors: Array<[string, number]> = [[ntlm('password'), 99999], [ntlm('123456'), 37281043]];
    const { content, idx: ntlmIdx } = buildNtlmFixture(vectors);
    const tmpFile = makeTestFilePath(`idx-ntlm-def-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, content, 'ascii');

    const map = new Map<number, Array<{ fullHash: string; fullHashBytes: Buffer }>>();
    const pwMap = new Map<string, Array<{ login_password: string }>>();
    vectors.forEach(([hash]) => {
      pwMap.set(hash, [{ login_password: 'pw' }]);
      const key = Buffer.from(hash, 'ascii').readUInt32BE(0);
      map.set(key, [{ fullHash: hash, fullHashBytes: Buffer.from(hash, 'ascii').subarray(0, 32) }]);
    });

    try {
      const out = await indexReader(tmpFile, content.length, map, null, 'ascii', ntlmIdx, pwMap);
      expect(out).toHaveLength(0);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('enriches missing hash with empty passwordObjects (covers line 163 ?? [])', async () => {
    const unknownHash = 'DEAD000000000000000000000000000000000000';
    const promisePoolModule = await import('../promisePool');
    const spy = vi.spyOn(promisePoolModule, 'promisePool').mockResolvedValue([{ results: [{ hash: unknownHash, leaks: 1 }], matchedHashCount: 1, cumulativeLeakCount: 1 }]);
    const pwMap = makeArgs(HASH_A);
    const map = buildLookupMap(HASH_A);
    const out = await indexReader(filePath, fileSize, map, null, encoding, idx, pwMap);
    expect(out).toHaveLength(1);
    expect(out[0].hash).toBe(unknownHash);
    expect(out[0].passwordObjects).toEqual([]);
    spy.mockRestore();
  });
});
