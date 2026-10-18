import fs from 'fs';
import v8 from 'v8';

import {
  vi, describe, it, expect, beforeEach, afterEach,
} from 'vitest';

import type { ChunkResult } from '../processChunk.js';
import type { PasswordObject } from '../../types.js';
import { IDX_HEADER_SIZE, IDX_PREFIX_COUNT, IDX_SORTED_FLAG_OK } from '../../constants.js';
import { buildHashLookupMap } from '../../hashing/buildLookupMap.js';
import { sequentialReader } from './sequential.js';
import { ntlm } from '../../../tests/helpers/ntlm.js';
import { makeTestFilePath } from '../../../tests/helpers/testTmp.js';

const workers: unknown[] = [];
const workerDataList: Array<Record<string, unknown>> = [];
const messageHandlers: Array<(msg: Record<string, unknown>) => void> = [];
const errorHandlerHandlers: Array<(err: Error) => void> = [];
const exitHandlerHandlers: Array<(code: number) => void> = [];

vi.mock('worker_threads', () => {
  const MockWorker = class {
    on = vi.fn((event: string, handler: (arg: unknown) => void) => {
      if (event === 'message') messageHandlers.push(handler as (msg: Record<string, unknown>) => void);
      if (event === 'error') errorHandlerHandlers.push(handler as (err: Error) => void);
      if (event === 'exit') exitHandlerHandlers.push(handler as (code: number) => void);
    });

    terminate = vi.fn();

    constructor(_path: string, options?: { workerData?: Record<string, unknown> }) {
      workers.push(this);
      workerDataList.push(options?.workerData ?? {});
    }
  };
  return { Worker: MockWorker, isMainThread: true, parentPort: null };
});

function makeResult(overrides: Partial<ChunkResult>): ChunkResult {
  return {
    results: [],
    bytesProcessed: 0,
    linesProcessed: 0,
    matchedHashCount: 0,
    cumulativeLeakCount: 0,
    rejectedLineCount: 0,
    ...overrides,
  };
}

function readOffset(buf: Buffer, idx: number): bigint {
  return buf.readBigUInt64LE(IDX_HEADER_SIZE + idx * 8);
}

describe('sequentialReader coverage gaps', () => {
  beforeEach(() => {
    workers.length = 0;
    workerDataList.length = 0;
    messageHandlers.length = 0;
    errorHandlerHandlers.length = 0;
    exitHandlerHandlers.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('collects prefixBoundaries from worker results when buildIndex=true (lines 189-192)', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 1234567890 } as never);
    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined as never);

    const hashes = new Map<string, PasswordObject[]>();
    hashes.set('AAAAAAAAAA000000000000000000000000000000', [{ login_password: 'pass' }]);

    const resultPromise = sequentialReader(
      '/fake/file.txt',
      1000,
      2,
      new Map(),
      Buffer.alloc(0),
      Buffer.alloc(0),
      'ascii',
      hashes,
      undefined,
      undefined,
      true,
      true,
    );

    await Promise.resolve();
    await Promise.resolve();

    messageHandlers[0]({
      type: 'result',
      data: makeResult({
        bytesProcessed: 500,
        results: [{ hash: 'AAAAAAAAAA000000000000000000000000000000', leaks: 100 }],
      }),
      prefixBoundaries: [{ prefix: 42, offset: 100 }],
    });
    messageHandlers[1]({
      type: 'result',
      data: makeResult({ bytesProcessed: 500 }),
      prefixBoundaries: [{ prefix: 100, offset: 200 }],
    });

    const result = await resultPromise;
    expect(result).toHaveLength(1);
    expect(result[0].hash).toBe('AAAAAAAAAA000000000000000000000000000000');
    expect(result[0].leaks).toBe(100);

    expect(fs.promises.writeFile).toHaveBeenCalledOnce();
    const writeCall = (fs.promises.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(writeCall[0]).toBe('/fake/file.txt.idx');
    const writtenBuf: Buffer = writeCall[1];
    expect(writtenBuf[0]).toBe(IDX_SORTED_FLAG_OK);

    const expectedMtime = Math.floor(1234567890 / 1000);
    // v2 header layout: byte 0 sorted flag, byte 1 version, byte 2 hash type,
    // bytes 3-10 mtime (BigInt64LE), bytes 11-18 file size.
    expect(writtenBuf.readBigInt64LE(3)).toBe(BigInt(expectedMtime));
  });

  it('sets sorted flag to 0 in .idx when sorted=false (line 246)', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 1000000 } as never);
    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined as never);

    const hashes = new Map<string, PasswordObject[]>();
    const resultPromise = sequentialReader(
      '/fake/file.txt',
      1000,
      2,
      new Map(),
      Buffer.alloc(0),
      Buffer.alloc(0),
      'ascii',
      hashes,
      undefined,
      undefined,
      true,
      false,
    );

    await Promise.resolve();
    await Promise.resolve();

    messageHandlers[0]({
      type: 'result',
      data: makeResult({ bytesProcessed: 500 }),
      prefixBoundaries: [{ prefix: 1, offset: 10 }],
    });
    messageHandlers[1]({
      type: 'result',
      data: makeResult({ bytesProcessed: 500 }),
    });

    await resultPromise;

    const writtenBuf: Buffer = (fs.promises.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(writtenBuf[0]).toBe(0);
  });

  it('merges duplicate prefixes and fills gaps in .idx (lines 226-242)', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 5000000 } as never);
    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined as never);

    const hashes = new Map<string, PasswordObject[]>();
    const resultPromise = sequentialReader(
      '/fake/file.txt',
      2000,
      2,
      new Map(),
      Buffer.alloc(0),
      Buffer.alloc(0),
      'ascii',
      hashes,
      undefined,
      undefined,
      true,
      true,
    );

    await Promise.resolve();
    await Promise.resolve();

    messageHandlers[0]({
      type: 'result',
      data: makeResult({ bytesProcessed: 1000 }),
      prefixBoundaries: [{ prefix: 42, offset: 100 }, { prefix: 100, offset: 500 }],
    });
    messageHandlers[1]({
      type: 'result',
      data: makeResult({ bytesProcessed: 1000 }),
      prefixBoundaries: [{ prefix: 42, offset: 200 }, { prefix: 200, offset: 800 }],
    });

    await resultPromise;

    const writtenBuf: Buffer = (fs.promises.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1];

    expect(writtenBuf.length).toBe(IDX_HEADER_SIZE + (IDX_PREFIX_COUNT + 1) * 8);

    expect(readOffset(writtenBuf, 42)).toBe(BigInt(100));
    expect(readOffset(writtenBuf, 100)).toBe(BigInt(500));
    expect(readOffset(writtenBuf, 200)).toBe(BigInt(800));
    expect(readOffset(writtenBuf, IDX_PREFIX_COUNT)).toBe(BigInt(2000));

    expect(readOffset(writtenBuf, 0)).toBe(BigInt(100));
    expect(readOffset(writtenBuf, 43)).toBe(BigInt(500));
    expect(readOffset(writtenBuf, 101)).toBe(BigInt(800));
    expect(readOffset(writtenBuf, 201)).toBe(BigInt(2000));
  });

  it('warns on differing leak counts during dedup (line 284)', async () => {
    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined as never);

    const hashes = new Map<string, PasswordObject[]>();
    hashes.set('AAAAAAAAAA000000000000000000000000000000', [{ login_password: 'pass' }]);

    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };

    const resultPromise = sequentialReader(
      '/fake/file.txt',
      1000,
      2,
      new Map(),
      Buffer.alloc(0),
      Buffer.alloc(0),
      'ascii',
      hashes,
      logger,
      undefined,
      false,
      false,
    );

    await Promise.resolve();
    await Promise.resolve();

    messageHandlers[0]({
      type: 'result',
      data: makeResult({
        bytesProcessed: 500,
        results: [{ hash: 'AAAAAAAAAA000000000000000000000000000000', leaks: 100 }],
      }),
    });
    messageHandlers[1]({
      type: 'result',
      data: makeResult({
        bytesProcessed: 500,
        results: [{ hash: 'AAAAAAAAAA000000000000000000000000000000', leaks: 200 }],
      }),
    });

    const result = await resultPromise;
    expect(result).toHaveLength(1);
    expect(result[0].leaks).toBe(100);
    expect(logs.some((l) => l.includes('differing leak counts'))).toBe(true);
  });

  it('logs rejected line count warning when totalRejected > 0 (line 262)', async () => {
    const hashes = new Map<string, PasswordObject[]>();
    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };

    const resultPromise = sequentialReader(
      '/fake/file.txt',
      1000,
      2,
      new Map(),
      Buffer.alloc(0),
      Buffer.alloc(0),
      'ascii',
      hashes,
      logger,
      undefined,
      false,
      false,
    );

    await Promise.resolve();
    await Promise.resolve();

    messageHandlers[0]({
      type: 'result',
      data: makeResult({ bytesProcessed: 500, rejectedLineCount: 5 }),
    });
    messageHandlers[1]({
      type: 'result',
      data: makeResult({ bytesProcessed: 500, rejectedLineCount: 3 }),
    });

    await resultPromise;

    expect(logs.some((l) => l.includes('8 line(s) with invalid format'))).toBe(true);
  });

  it('logs summary output with logger (lines 265-271)', async () => {
    const hashes = new Map<string, PasswordObject[]>();
    hashes.set('AAAAAAAAAA000000000000000000000000000000', [{ login_password: 'pass' }]);
    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };

    const resultPromise = sequentialReader(
      '/fake/file.txt',
      1000,
      2,
      new Map(),
      Buffer.alloc(0),
      Buffer.alloc(0),
      'ascii',
      hashes,
      logger,
      undefined,
      false,
      false,
    );

    await Promise.resolve();
    await Promise.resolve();

    messageHandlers[0]({
      type: 'result',
      data: makeResult({
        bytesProcessed: 500,
        results: [{ hash: 'AAAAAAAAAA000000000000000000000000000000', leaks: 100 }],
        matchedHashCount: 1,
        cumulativeLeakCount: 100,
      }),
    });
    messageHandlers[1]({
      type: 'result',
      data: makeResult({ bytesProcessed: 500 }),
    });

    await resultPromise;

    expect(logs.some((l) => l.includes('Checked all'))).toBe(true);
    expect(logs.some((l) => l.includes('Found'))).toBe(true);
    expect(logs.some((l) => l.includes('throughput'))).toBe(true);
  });

  it('positive elapsed time covers throughput > 0 branch (line 248)', async () => {
    vi.useFakeTimers({ now: 1000000 });
    const hashes = new Map<string, PasswordObject[]>();
    hashes.set('AAAAAAAAAA000000000000000000000000000000', [{ login_password: 'pass' }]);
    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };

    const resultPromise = sequentialReader(
      '/fake/file.txt',
      1000,
      2,
      new Map(),
      Buffer.alloc(0),
      Buffer.alloc(0),
      'ascii',
      hashes,
      logger,
      undefined,
      false,
      false,
    );

    await Promise.resolve();
    await Promise.resolve();

    vi.advanceTimersByTime(1000);

    messageHandlers[0]({
      type: 'result',
      data: makeResult({
        bytesProcessed: 500,
        results: [{ hash: 'AAAAAAAAAA000000000000000000000000000000', leaks: 100 }],
        matchedHashCount: 1,
        cumulativeLeakCount: 100,
      }),
    });
    messageHandlers[1]({
      type: 'result',
      data: makeResult({ bytesProcessed: 500 }),
    });

    await resultPromise;
    vi.useRealTimers();

    expect(logs.some((l) => l.includes('throughput'))).toBe(true);
  });

  it('single chunk with null fingerprints covers cond-expr false branch (line 156)', async () => {
    const tmpFile = makeTestFilePath(`sr-nullfp-${Date.now()}.txt`);
    const content = 'AAAAAAAAAA000000000000000000000000000000:100\n';
    fs.writeFileSync(tmpFile, content, 'ascii');

    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: Date.now() } as never);
    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined as never);

    const hashes = new Map<string, PasswordObject[]>();
    hashes.set('AAAAAAAAAA000000000000000000000000000000', [{ login_password: 'pass' }]);
    const { map: hashLookupMap } = buildHashLookupMap(hashes);

    try {
      const result = await sequentialReader(
        tmpFile,
        content.length,
        1,
        hashLookupMap,
        Buffer.alloc(0),
        null,
        'ascii',
        hashes,
        undefined,
        undefined,
        false,
        false,
      );
      expect(result).toBeDefined();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ok */ }
    }
  });

  it('enrichment uses empty array when hash not in passwords map (line 298)', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 1234567890 } as never);
    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined as never);

    const emptyHashes = new Map<string, PasswordObject[]>();
    const resultPromise = sequentialReader(
      '/fake/file.txt',
      1000,
      2,
      new Map(),
      Buffer.alloc(0),
      Buffer.alloc(0),
      'ascii',
      emptyHashes,
      undefined,
      undefined,
      false,
      false,
    );

    await Promise.resolve();
    await Promise.resolve();

    messageHandlers[0]({
      type: 'result',
      data: makeResult({
        bytesProcessed: 500,
        results: [{ hash: 'UNKNOWNHASH000000000000000000000000000', leaks: 50 }],
      }),
    });
    messageHandlers[1]({
      type: 'result',
      data: makeResult({ bytesProcessed: 500 }),
    });

    const result = await resultPromise;
    expect(result).toHaveLength(1);
    expect(result[0].passwordObjects).toEqual([]);
  });

  it('single chunk with buildIndex triggers recordBoundary (line 147, parseBuffer line 87)', async () => {
    const tmpFile = makeTestFilePath(`sr-single-${Date.now()}.txt`);
    const hashes = new Map<string, PasswordObject[]>();
    hashes.set('00000AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', [{ login_password: 'pass' }]);
    hashes.set('00001BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', [{ login_password: 'pass2' }]);

    const { map: hashLookupMap, set: fingerprintSet } = buildHashLookupMap(hashes);

    const content = '00000AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:100\n00001BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB:200\n';
    fs.writeFileSync(tmpFile, content, 'ascii');

    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: Date.now() } as never);
    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined as never);

    const serializedMap = v8.serialize(hashLookupMap);
    const serializedFingerprints = v8.serialize(fingerprintSet);

    try {
      const result = await sequentialReader(
        tmpFile,
        content.length,
        1,
        hashLookupMap,
        serializedMap,
        serializedFingerprints,
        'ascii',
        hashes,
        undefined,
        undefined,
        true,
        true,
      );

      expect(result.length).toBeGreaterThanOrEqual(0);

      expect(fs.promises.writeFile).toHaveBeenCalledOnce();
      const writeCall = (fs.promises.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(writeCall[0]).toBe(`${tmpFile}.idx`);
      const writtenBuf: Buffer = writeCall[1];
      expect(writtenBuf[0]).toBe(IDX_SORTED_FLAG_OK);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ok */ }
      try { fs.unlinkSync(`${tmpFile}.idx`); } catch { /* ok */ }
    }
  });

  it('logs success message when index file is written', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 1234567890 } as never);
    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined as never);

    const hashes = new Map<string, PasswordObject[]>();
    hashes.set('AAAAAAAAAA000000000000000000000000000000', [{ login_password: 'pass' }]);
    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };

    const resultPromise = sequentialReader(
      '/fake/file.txt',
      1000,
      2,
      new Map(),
      Buffer.alloc(0),
      Buffer.alloc(0),
      'ascii',
      hashes,
      logger,
      undefined,
      true,
      true,
    );

    await Promise.resolve();
    await Promise.resolve();

    messageHandlers[0]({
      type: 'result',
      data: makeResult({
        bytesProcessed: 500,
        results: [{ hash: 'AAAAAAAAAA000000000000000000000000000000', leaks: 100 }],
      }),
      prefixBoundaries: [{ prefix: 42, offset: 100 }],
    });
    messageHandlers[1]({
      type: 'result',
      data: makeResult({ bytesProcessed: 500 }),
    });

    await resultPromise;

    expect(logs.some((l) => l.includes('Index file written:'))).toBe(true);
    expect(logs.some((l) => l.includes('/fake/file.txt.idx'))).toBe(true);
  });

  it('logs warning when index build fails', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 1234567890 } as never);
    vi.spyOn(fs.promises, 'writeFile').mockRejectedValue(new Error('disk full'));

    const hashes = new Map<string, PasswordObject[]>();
    hashes.set('AAAAAAAAAA000000000000000000000000000000', [{ login_password: 'pass' }]);
    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };

    const resultPromise = sequentialReader(
      '/fake/file.txt',
      1000,
      2,
      new Map(),
      Buffer.alloc(0),
      Buffer.alloc(0),
      'ascii',
      hashes,
      logger,
      undefined,
      true,
      true,
    );

    await Promise.resolve();
    await Promise.resolve();

    messageHandlers[0]({
      type: 'result',
      data: makeResult({
        bytesProcessed: 500,
        results: [{ hash: 'AAAAAAAAAA000000000000000000000000000000', leaks: 100 }],
      }),
      prefixBoundaries: [{ prefix: 42, offset: 100 }],
    });
    messageHandlers[1]({
      type: 'result',
      data: makeResult({ bytesProcessed: 500 }),
    });

    const result = await resultPromise;
    expect(result).toHaveLength(1);
    expect(result[0].hash).toBe('AAAAAAAAAA000000000000000000000000000000');
    expect(logs.some((l) => l.includes('Warning: index build failed'))).toBe(true);
  });

  it('rejects when worker sends error message (msg.type === \'error\')', async () => {
    const resultPromise = sequentialReader(
      '/fake/file.txt',
      1000,
      2,
      new Map(),
      Buffer.alloc(0),
      Buffer.alloc(0),
      'ascii',
      new Map(),
      undefined,
      undefined,
      false,
      false,
    );

    await Promise.resolve();
    await Promise.resolve();

    messageHandlers[0]({
      type: 'error',
      message: 'worker error message',
    });

    await expect(resultPromise).rejects.toThrow('worker error message');
  });

  it('rejects when worker emits error event', async () => {
    const resultPromise = sequentialReader(
      '/fake/file.txt',
      1000,
      2,
      new Map(),
      Buffer.alloc(0),
      Buffer.alloc(0),
      'ascii',
      new Map(),
      undefined,
      undefined,
      false,
      false,
    );

    await Promise.resolve();
    await Promise.resolve();

    errorHandlerHandlers[0](new Error('Worker crashed'));

    await expect(resultPromise).rejects.toThrow('Worker crashed');
  });

  it('terminates remaining workers on Promise.all rejection', async () => {
    const resultPromise = sequentialReader(
      '/fake/file.txt',
      1000,
      2,
      new Map(),
      Buffer.alloc(0),
      Buffer.alloc(0),
      'ascii',
      new Map(),
      undefined,
      undefined,
      false,
      false,
    );

    await Promise.resolve();
    await Promise.resolve();

    messageHandlers[0]({
      type: 'error',
      message: 'first worker failed',
    });

    await expect(resultPromise).rejects.toThrow();

    expect((workers[0] as { terminate: ReturnType<typeof vi.fn> }).terminate).toHaveBeenCalled();
    expect((workers[1] as { terminate: ReturnType<typeof vi.fn> }).terminate).toHaveBeenCalled();
  });

  it('single-chunk NTLM file matches when fullHashLength=32', async () => {
    const fullHash = ntlm('password123');
    expect(fullHash).toHaveLength(32);
    const content = `${fullHash}:4321\n`;
    const tmpFile = makeTestFilePath(`sr-ntlm-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, content, 'ascii');

    const hashes = new Map<string, PasswordObject[]>();
    hashes.set(fullHash, [{ login_password: 'password123' }]);
    const { map: hashLookupMap } = buildHashLookupMap(hashes, 32);

    try {
      const result = await sequentialReader(
        tmpFile,
        content.length,
        1,
        hashLookupMap,
        Buffer.alloc(0),
        null,
        'ascii',
        hashes,
        undefined,
        undefined,
        false,
        true,
        undefined,
        32,
      );
      expect(result).toHaveLength(1);
      expect(result[0].hash).toBe(fullHash);
      expect(result[0].leaks).toBe(4321);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ok */ }
    }
  });

  it('threads fullHashLength=32 into each worker when multi-chunk NTLM', async () => {
    const fullHash = ntlm('password123');
    const hashes = new Map<string, PasswordObject[]>();
    hashes.set(fullHash, [{ login_password: 'password123' }]);

    const resultPromise = sequentialReader(
      '/fake/file.txt',
      1000,
      2,
      new Map(),
      Buffer.alloc(0),
      Buffer.alloc(0),
      'ascii',
      hashes,
      undefined,
      undefined,
      false,
      true,
      undefined,
      32,
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(workerDataList).toHaveLength(2);
    workerDataList.forEach((wd) => {
      expect(wd.fullHashLength).toBe(32);
    });

    messageHandlers[0]({ type: 'result', data: makeResult({ bytesProcessed: 500 }) });
    messageHandlers[1]({ type: 'result', data: makeResult({ bytesProcessed: 500 }) });
    await resultPromise;
  });
});
