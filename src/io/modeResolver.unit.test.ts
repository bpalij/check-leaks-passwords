import fs from 'fs';

import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';

import {
  validateForcedMode,
  resolveMode,
  detectSortednessAndCleanup,
  tryLoadIndex,
  formatReadModeLog,
  dispatchReader,
  type DispatchParams,
} from './modeResolver.js';
import type { ReadModeEvaluation } from './readModeEvaluator.js';
import type { HashWithLeaksAndPasswordObjects } from '../types.js';
import { detectSortedness } from '../hashing/detectSortedness.js';
import { binarySearchReader } from './readModes/binarySearch.js';
import { indexReader } from './readModes/indexBased.js';
import { encodeIndexHeader } from './indexHeader.js';
import {
  IDX_HEADER_SIZE,
  IDX_HASH_TYPE_SHA1,
  IDX_HASH_TYPE_NTLM,
  IDX_PREFIX_COUNT,
} from '../constants.js';

vi.mock('../hashing/detectSortedness.js', () => ({
  detectSortedness: vi.fn(),
}));

vi.mock('./readModes/binarySearch.js', () => ({
  binarySearchReader: vi.fn(),
}));

vi.mock('./readModes/indexBased.js', () => ({
  indexReader: vi.fn(),
}));

describe('validateForcedMode', () => {
  it('returns undefined when envMode is undefined', () => {
    expect(validateForcedMode(undefined)).toBeUndefined();
  });

  it('returns undefined when envMode is empty string', () => {
    expect(validateForcedMode('')).toBeUndefined();
  });

  it.each([
    'binary',
    'index',
    'sequential-noindex',
    'sequential-index',
  ] as const)(
    'returns mode string for valid mode "%s"',
    (mode) => {
      expect(validateForcedMode(mode)).toBe(mode);
    },
  );

  it.each([
    'invalid',
    'auto',
    'sequential',
  ])(
    'throws for invalid mode string "%s"',
    (mode) => {
      expect(() => validateForcedMode(mode)).toThrow('READ_MODE_FORCED must be one of');
    },
  );
});

describe('resolveMode', () => {
  it('returns binary mode with buildIdx=false when envMode is "binary"', () => {
    expect(resolveMode('binary', undefined, false)).toEqual({ mode: 'binary', buildIdx: false });
  });

  it('returns index mode with buildIdx=true when envMode is "index"', () => {
    expect(resolveMode('index', undefined, false)).toEqual({ mode: 'index', buildIdx: true });
  });

  it('returns sequential mode with buildIdx=false when envMode is "sequential-noindex"', () => {
    expect(resolveMode('sequential-noindex', undefined, false)).toEqual({ mode: 'sequential', buildIdx: false });
  });

  it('returns sequential mode with buildIdx=true when envMode is "sequential-index"', () => {
    expect(resolveMode('sequential-index', undefined, false)).toEqual({ mode: 'sequential', buildIdx: true });
  });

  it('uses singleFileReadMode and buildIndex when envMode is undefined', () => {
    expect(resolveMode(undefined, 'binary', true)).toEqual({ mode: 'binary', buildIdx: true });
  });

  it('defaults to "auto" and false when both envMode and singleFileReadMode are undefined', () => {
    expect(resolveMode(undefined, undefined, false)).toEqual({ mode: 'auto', buildIdx: false });
  });
});

describe('detectSortednessAndCleanup', () => {
  beforeEach(() => {
    vi.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns "sorted" and logs "File sorted: yes" when file is sorted', async () => {
    vi.mocked(detectSortedness).mockResolvedValue('sorted');
    const logger = vi.fn();

    const result = await detectSortednessAndCleanup('/path/file.txt', logger);

    expect(result).toBe('sorted');
    expect(logger).toHaveBeenCalledWith('File sorted: yes');
    expect(logger).not.toHaveBeenCalledWith('Warning: file not sorted');
  });

  it('returns "unsorted" and logs "File sorted: no" plus warning when file is not sorted', async () => {
    vi.mocked(detectSortedness).mockResolvedValue('unsorted');
    const logger = vi.fn();

    const result = await detectSortednessAndCleanup('/path/file.txt', logger);

    expect(result).toBe('unsorted');
    expect(logger).toHaveBeenCalledWith('File sorted: no');
    expect(logger).toHaveBeenCalledWith('Warning: file not sorted');
  });

  it('returns "skipped" with a neutral log and no "not sorted" claim (FR-014)', async () => {
    vi.mocked(detectSortedness).mockResolvedValue('skipped');
    const logger = vi.fn();

    const result = await detectSortednessAndCleanup('/path/file.txt', logger);

    expect(result).toBe('skipped');
    expect(logger).toHaveBeenCalledWith(
      'File < 1 GiB — sortedness check skipped; sequential read only',
    );
    const messages = logger.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => /not sorted|unsorted/i.test(m))).toBe(false);
  });

  it('calls fs.promises.unlink with .idx path when verdict is "unsorted"', async () => {
    vi.mocked(detectSortedness).mockResolvedValue('unsorted');

    await detectSortednessAndCleanup('/path/file.txt');

    expect(fs.promises.unlink).toHaveBeenCalledWith('/path/file.txt.idx');
  });

  it('calls fs.promises.unlink with .idx path when verdict is "skipped"', async () => {
    vi.mocked(detectSortedness).mockResolvedValue('skipped');

    await detectSortednessAndCleanup('/path/file.txt');

    expect(fs.promises.unlink).toHaveBeenCalledWith('/path/file.txt.idx');
  });

  it('does not call fs.promises.unlink when verdict is "sorted"', async () => {
    vi.mocked(detectSortedness).mockResolvedValue('sorted');

    await detectSortednessAndCleanup('/path/file.txt');

    expect(fs.promises.unlink).not.toHaveBeenCalled();
  });

  it('does not propagate error when unlink throws ENOENT', async () => {
    vi.mocked(detectSortedness).mockResolvedValue('unsorted');
    vi.mocked(fs.promises.unlink).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    await expect(detectSortednessAndCleanup('/path/file.txt')).resolves.toBe('unsorted');
  });

  it('works without logger and still returns correctly', async () => {
    vi.mocked(detectSortedness).mockResolvedValue('sorted');

    const result = await detectSortednessAndCleanup('/path/file.txt');

    expect(result).toBe('sorted');
  });
});

describe('tryLoadIndex', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when fs.promises.stat throws', async () => {
    vi.spyOn(fs.promises, 'stat').mockRejectedValue(new Error('ENOENT'));

    const result = await tryLoadIndex('/path/file.txt', 1000, new Map());

    expect(result).toBeNull();
  });

  it('returns null when idx mtimeMs <= fileMtimeMs (stale idx)', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 500 } as fs.Stats);

    const result = await tryLoadIndex('/path/file.txt', 1000, new Map());

    expect(result).toBeNull();
  });

  it('returns null when idx mtimeMs equals fileMtimeMs (not strictly greater)', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 1000 } as fs.Stats);

    const result = await tryLoadIndex('/path/file.txt', 1000, new Map());

    expect(result).toBeNull();
  });

  it('returns { idx, uniquePrefixCount } when idx is fresh and valid', async () => {
    const idxBuf = Buffer.alloc(IDX_HEADER_SIZE + (IDX_PREFIX_COUNT + 1) * 8);
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 2000 } as fs.Stats);
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(idxBuf);

    const hashes = new Map<string, Array<{ login_password: string }>>();
    hashes.set('aaaaa11111', [{ login_password: 'p1' }]);
    hashes.set('bbbbb22222', [{ login_password: 'p2' }]);

    const result = await tryLoadIndex('/path/file.txt', 1000, hashes);

    expect(result).not.toBeNull();
    expect(result!.idx).toBeInstanceOf(BigUint64Array);
    expect(result!.idx.length).toBe(IDX_PREFIX_COUNT + 1);
    expect(result!.uniquePrefixCount).toBe(2);
  });

  it('logs "Fresh .idx found" when logger is provided and idx is fresh', async () => {
    const idxBuf = Buffer.alloc(IDX_HEADER_SIZE + (IDX_PREFIX_COUNT + 1) * 8);
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 2000 } as fs.Stats);
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(idxBuf);
    const logger = vi.fn();

    await tryLoadIndex('/path/file.txt', 1000, new Map(), logger);

    expect(logger).toHaveBeenCalledWith('Fresh .idx found');
  });

  it('does not log when idx is stale', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 500 } as fs.Stats);
    const logger = vi.fn();

    await tryLoadIndex('/path/file.txt', 1000, new Map(), logger);

    expect(logger).not.toHaveBeenCalled();
  });

  /**
   * Build a v2 `.idx` buffer with the given header metadata.
   *
   * @param hashType - Hash-type code to store in the header.
   * @param fileSize - Corpus file size to store in the header.
   * @returns A complete `.idx` buffer (header + zeroed offsets).
   */
  function fakeIdx(hashType: number, fileSize: bigint): Buffer {
    const header = encodeIndexHeader({
      sorted: true, hashType, mtime: 0n, fileSize,
    });
    return Buffer.concat([header, Buffer.alloc((IDX_PREFIX_COUNT + 1) * 8)]);
  }

  it('accepts a fresh .idx whose metadata matches the corpus', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 2000 } as fs.Stats);
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(
      fakeIdx(IDX_HASH_TYPE_SHA1, 500n),
    );

    const result = await tryLoadIndex(
      '/path/file.txt',
      1000,
      new Map(),
      undefined,
      { fullHashLength: 40, fileSize: 500 },
    );

    expect(result).not.toBeNull();
  });

  it('rejects a fresh .idx built for a different hash type', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 2000 } as fs.Stats);
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(
      fakeIdx(IDX_HASH_TYPE_NTLM, 500n),
    );

    const result = await tryLoadIndex(
      '/path/file.txt',
      1000,
      new Map(),
      undefined,
      { fullHashLength: 40, fileSize: 500 },
    );

    expect(result).toBeNull();
  });

  it('rejects a fresh SHA-1 .idx when NTLM is expected (symmetric mismatch)', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 2000 } as fs.Stats);
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(
      fakeIdx(IDX_HASH_TYPE_SHA1, 500n),
    );

    const result = await tryLoadIndex(
      '/path/file.txt',
      1000,
      new Map(),
      undefined,
      { fullHashLength: 32, fileSize: 500 },
    );

    expect(result).toBeNull();
  });

  it('accepts a fresh NTLM .idx when NTLM is expected', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 2000 } as fs.Stats);
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(
      fakeIdx(IDX_HASH_TYPE_NTLM, 500n),
    );

    const result = await tryLoadIndex(
      '/path/file.txt',
      1000,
      new Map(),
      undefined,
      { fullHashLength: 32, fileSize: 500 },
    );

    expect(result).not.toBeNull();
  });

  it('rejects a fresh .idx built for a different file size (same-path swap)', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 2000 } as fs.Stats);
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(
      fakeIdx(IDX_HASH_TYPE_SHA1, 999n),
    );

    const result = await tryLoadIndex(
      '/path/file.txt',
      1000,
      new Map(),
      undefined,
      { fullHashLength: 40, fileSize: 500 },
    );

    expect(result).toBeNull();
  });

  it('rejects a legacy (pre-metadata) .idx and treats it as stale', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ mtimeMs: 2000 } as fs.Stats);
    const header = Buffer.alloc(IDX_HEADER_SIZE);
    header[0] = 0x01;
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(
      Buffer.concat([header, Buffer.alloc((IDX_PREFIX_COUNT + 1) * 8)]),
    );

    const result = await tryLoadIndex(
      '/path/file.txt',
      1000,
      new Map(),
      undefined,
      { fullHashLength: 40, fileSize: 500 },
    );

    expect(result).toBeNull();
  });
});

describe('formatReadModeLog', () => {
  const fmt = (ms: number) => `${ms}ms`;

  it('formats sequential only (no idx, no bin times)', () => {
    const ev: ReadModeEvaluation = { reader: 'sequential', seqTimeMs: 100 };
    expect(formatReadModeLog(ev, fmt)).toBe('Read modes: sequential 100ms');
  });

  it('formats sequential + binary times', () => {
    const ev: ReadModeEvaluation = { reader: 'binary', seqTimeMs: 100, binTimeMs: 50 };
    expect(formatReadModeLog(ev, fmt)).toBe('Read modes: binary 50ms ✓ | sequential 100ms');
  });

  it('formats all three (idx, bin, seq)', () => {
    const ev: ReadModeEvaluation = {
      reader: 'index', seqTimeMs: 100, binTimeMs: 50, idxTimeMs: 30,
    };
    expect(formatReadModeLog(ev, fmt)).toBe('Read modes: index 30ms ✓ | binary 50ms | sequential 100ms');
  });

  it('shows checkmark when forcedMode matches reader', () => {
    const ev: ReadModeEvaluation = { reader: 'sequential', seqTimeMs: 100, binTimeMs: 50 };
    expect(formatReadModeLog(ev, fmt, 'binary')).toBe('Read modes: binary 50ms ✓ | sequential 100ms');
  });

  it('does not show checkmark when forcedMode does not match reader', () => {
    const ev: ReadModeEvaluation = { reader: 'sequential', seqTimeMs: 100, binTimeMs: 50 };
    expect(formatReadModeLog(ev, fmt, 'index')).toBe('Read modes: binary 50ms | sequential 100ms');
  });

  it('shows checkmark on index when forcedMode is index even if reader is binary', () => {
    const ev: ReadModeEvaluation = {
      reader: 'binary', seqTimeMs: 100, idxTimeMs: 30, binTimeMs: 50,
    };
    expect(formatReadModeLog(ev, fmt, 'index')).toBe('Read modes: index 30ms ✓ | binary 50ms ✓ | sequential 100ms');
  });
});

describe('dispatchReader', () => {
  const mockResult: HashWithLeaksAndPasswordObjects[] = [{ hash: 'result', leaks: 1, passwordObjects: [] }];

  const baseParams: DispatchParams = {
    filePath: '/path/file.txt',
    fileSize: 1024,
    hashLookupMap: new Map(),
    fingerprintSet: null,
    encoding: 'utf-8',
    hashesWithPasswordObjects: new Map(),
    isHDD: false,
    runSequential: vi.fn().mockResolvedValue(mockResult),
  };

  beforeEach(() => {
    vi.mocked(indexReader).mockResolvedValue([]);
    vi.mocked(binarySearchReader).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls indexReader when ev.reader is "index" and params.idx exists', async () => {
    const idx = new BigUint64Array(10);
    const ev: ReadModeEvaluation = { reader: 'index', seqTimeMs: 100, idxTimeMs: 30 };
    vi.mocked(indexReader).mockResolvedValue(mockResult);

    const result = await dispatchReader(ev, { ...baseParams, idx });

    expect(indexReader).toHaveBeenCalledOnce();
    expect(result).toBe(mockResult);
  });

  it('calls binarySearchReader when ev.reader is "binary"', async () => {
    const ev: ReadModeEvaluation = { reader: 'binary', seqTimeMs: 100, binTimeMs: 50 };
    vi.mocked(binarySearchReader).mockResolvedValue(mockResult);

    const result = await dispatchReader(ev, baseParams);

    expect(binarySearchReader).toHaveBeenCalledOnce();
    expect(result).toBe(mockResult);
  });

  it('calls runSequential when ev.reader is "sequential"', async () => {
    const ev: ReadModeEvaluation = { reader: 'sequential', seqTimeMs: 100 };
    const runSequential = vi.fn().mockResolvedValue(mockResult);

    const result = await dispatchReader(ev, { ...baseParams, runSequential });

    expect(runSequential).toHaveBeenCalledOnce();
    expect(result).toBe(mockResult);
  });

  it('falls through to runSequential when ev.reader is "index" but params.idx is undefined', async () => {
    const ev: ReadModeEvaluation = { reader: 'index', seqTimeMs: 100, idxTimeMs: 30 };
    const runSequential = vi.fn().mockResolvedValue(mockResult);

    const result = await dispatchReader(ev, { ...baseParams, idx: undefined, runSequential });

    expect(indexReader).not.toHaveBeenCalled();
    expect(runSequential).toHaveBeenCalledOnce();
    expect(result).toBe(mockResult);
  });
});
