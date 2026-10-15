import fs from 'fs';
import path from 'path';

import { vi } from 'vitest';

import { detectSortedness } from './detectSortedness.js';
import {
  IDX_HASH_TYPE_SHA1,
  IDX_HEADER_SIZE,
  IDX_SORTED_FLAG_OK,
  IDX_VERSION_V2,
  IDX_VERSION_V3,
  SMALL_FILE_BYTES_THRESHOLD,
  SORTEDNESS_MAX_REGIONS,
  SORTEDNESS_REGION_READ_BYTES,
} from '../constants.js';
import { computeRegionCount } from './sortednessSampling.js';
import { FIXTURES_DIR } from '../../tests/helpers/fixturesDir.js';

const GIB = 1024 * 1024 * 1024;
const TIB = 1024 * GIB;

/** Head/tail window size in bytes (must match `detectSortedness`). */
const HEAD_TAIL_WINDOW_BYTES = 8000;

/**
 * Read the recorded `(buf, offset, length, position)` calls from a mock fd.
 *
 * @param fd - A mock file handle produced by {@link createMockFd}.
 * @returns The raw `(buf, offset, length, position)` argument tuples passed to `fd.read`.
 */
function readCalls(fd: fs.FileHandle): Array<[Buffer, number, number, number]> {
  const mocked = fd as unknown as {
    read: { mock: { calls: Array<[Buffer, number, number, number]> } };
  };
  return mocked.read.mock.calls;
}

/** Fixed-width virtual line: 40-hex hash + ':1' + '\n'. */
const VIRTUAL_LINE_BYTES = 43;

type MockReadFn = (
  buf: Buffer, off: number, length: number, position: number,
) => Promise<{ bytesRead: number; buffer: Buffer }>;

function createMockFd(readFn: MockReadFn) {
  return {
    read: vi.fn(readFn),
    close: vi.fn(),
    async [Symbol.asyncDispose]() { await this.close(); },
  } as unknown as fs.FileHandle;
}

function createMockStats(size: number, mtimeMs: number) {
  return { size, mtimeMs } as fs.Stats;
}

/**
 * Build a positioned-read mock fd backed by a virtual corpus of fixed-width
 * lines, so a logically >= 1 GiB file never needs real storage.
 *
 * @param fileSize - Virtual corpus size (bytes).
 * @param unsortedHalves - When true, the second half restarts hashes at 0
 *   (two internally sorted halves that are globally reversed).
 * @returns A mock `fs.FileHandle` whose reads are served from the virtual corpus.
 */
function createVirtualCorpusFd(fileSize: number, unsortedHalves: boolean) {
  const totalLines = Math.floor(fileSize / VIRTUAL_LINE_BYTES);
  const halfLines = Math.floor(totalLines / 2);

  const lineHash = (i: number): string => {
    const logical = unsortedHalves && i >= halfLines ? i - halfLines : i;
    return logical.toString(16).padStart(40, '0');
  };

  return createMockFd(async (buf, _off, length, position) => {
    if (position >= fileSize) return { bytesRead: 0, buffer: buf };
    const n = Math.min(length, fileSize - position);
    let filled = 0;
    while (filled < n) {
      const abs = position + filled;
      const lineIndex = Math.floor(abs / VIRTUAL_LINE_BYTES);
      const lineOffset = abs % VIRTUAL_LINE_BYTES;
      const line = `${lineHash(lineIndex)}:1\n`;
      const slice = line.slice(lineOffset, lineOffset + (n - filled));
      buf.write(slice, filled, 'ascii');
      filled += slice.length;
    }
    return { bytesRead: n, buffer: buf };
  });
}

function buildV3IdxHeader({ sorted, fileSize }: { sorted: boolean; fileSize: number }): Buffer {
  const header = Buffer.alloc(IDX_HEADER_SIZE);
  header[0] = sorted ? IDX_SORTED_FLAG_OK : 0;
  header[1] = IDX_VERSION_V3;
  header[2] = IDX_HASH_TYPE_SHA1;
  header.writeBigUInt64LE(BigInt(fileSize), 11);
  return header;
}

function headerReadFd(header: Buffer) {
  return createMockFd(async (buf, off, length, _pos) => {
    header.copy(buf, off, 0, Math.min(length, header.length));
    return { bytesRead: Math.min(length, header.length), buffer: buf };
  });
}

describe('detectSortedness', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('skip gate (fileSize < 1 GiB)', () => {
    it.each([
      ['sorted fixture', 'sorted-hashes.txt'],
      ['unsorted fixture', 'unsorted-hashes.txt'],
      ['small fixture', 'small-sorted-hashes.txt'],
      ['empty fixture', 'empty-hashes.txt'],
      ['short-lines fixture', 'sorted-with-short-lines-hashes.txt'],
      ['CRLF fixture', 'sorted-with-cr-hashes.txt'],
    ])('returns "skipped" for %s (small corpus, no reads, no .idx consult)', async (_name, file) => {
      const openSpy = vi.spyOn(fs.promises, 'open');
      const result = await detectSortedness(path.join(FIXTURES_DIR, file));
      expect(result).toBe('skipped');
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('performs no .idx stat and no fd reads for a small corpus', async () => {
      const statSpy = vi.spyOn(fs.promises, 'stat')
        .mockResolvedValue(createMockStats(SMALL_FILE_BYTES_THRESHOLD - 1, 100));
      const openSpy = vi.spyOn(fs.promises, 'open');

      try {
        const result = await detectSortedness('/fake/small.txt');
        expect(result).toBe('skipped');
        expect(statSpy).toHaveBeenCalledTimes(1);
        expect(statSpy).toHaveBeenCalledWith('/fake/small.txt');
        expect(openSpy).not.toHaveBeenCalled();
      } finally {
        statSpy.mockRestore();
        openSpy.mockRestore();
      }
    });
  });

  describe('live check (fileSize >= 1 GiB)', () => {
    it('returns "sorted" for a sorted corpus', async () => {
      const statSpy = vi.spyOn(fs.promises, 'stat')
        .mockResolvedValue(createMockStats(GIB, 100));
      const openSpy = vi.spyOn(fs.promises, 'open')
        .mockResolvedValue(createVirtualCorpusFd(GIB, false));

      try {
        expect(await detectSortedness('/fake/sorted.txt')).toBe('sorted');
        expect(openSpy).toHaveBeenCalledWith('/fake/sorted.txt', 'r');
      } finally {
        statSpy.mockRestore();
        openSpy.mockRestore();
      }
    });

    it('returns "unsorted" for two internally sorted halves written in reverse (SC-001)', async () => {
      const statSpy = vi.spyOn(fs.promises, 'stat')
        .mockResolvedValue(createMockStats(GIB, 100));
      const openSpy = vi.spyOn(fs.promises, 'open')
        .mockResolvedValue(createVirtualCorpusFd(GIB, true));

      try {
        expect(await detectSortedness('/fake/reversed.txt')).toBe('unsorted');
      } finally {
        statSpy.mockRestore();
        openSpy.mockRestore();
      }
    });

    it('reports "unsorted" with a content-free diagnostic when a region window has no complete line (FR-012)', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const statSpy = vi.spyOn(fs.promises, 'stat')
        .mockResolvedValue(createMockStats(GIB, 100));
      // Every window is a run of non-hex bytes with no newline: head/tail
      // tolerate this, but a region sample has no complete line and must fail
      // explicitly rather than pass silently (contract §5).
      const noNewlineFd = createMockFd(async (buf, _off, length) => {
        buf.fill(0x41, 0, length);
        return { bytesRead: length, buffer: buf };
      });
      vi.spyOn(fs.promises, 'open').mockResolvedValue(noNewlineFd);

      try {
        expect(await detectSortedness('/fake/no-newline.txt')).toBe('unsorted');
        const output = errSpy.mock.calls.flat().map(String).join('\n');
        expect(output).toContain('Sortedness check diagnostic');
        expect(output).not.toMatch(/[0-9a-f]{40}/i);
      } finally {
        errSpy.mockRestore();
        statSpy.mockRestore();
        vi.restoreAllMocks();
      }
    });

    it('reports "unsorted" when a region window has newlines but no extractable hash (FR-012)', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const statSpy = vi.spyOn(fs.promises, 'stat')
        .mockResolvedValue(createMockStats(GIB, 100));
      // Newline-terminated lines that are all shorter than a full hash: the
      // window has complete lines but no usable anchor, so the sample must
      // fail explicitly (contract §5).
      const shortLineFd = createMockFd(async (buf, _off, length) => {
        const line = Buffer.from('short\n', 'ascii');
        const content = Buffer.alloc(length);
        for (let i = 0; i < length; i += 1) content[i] = line[i % line.length];
        content.copy(buf, 0, 0, length);
        return { bytesRead: length, buffer: buf };
      });
      vi.spyOn(fs.promises, 'open').mockResolvedValue(shortLineFd);

      try {
        expect(await detectSortedness('/fake/short-lines.txt')).toBe('unsorted');
        expect(errSpy.mock.calls.flat().map(String).join('\n'))
          .toContain('Sortedness check diagnostic');
      } finally {
        errSpy.mockRestore();
        statSpy.mockRestore();
        vi.restoreAllMocks();
      }
    });

    it('issues only fixed-size reads with a bounded total for a huge corpus (FR-005, SC-005)', async () => {
      const hugeSize = 10 * TIB;
      const statSpy = vi.spyOn(fs.promises, 'stat')
        .mockResolvedValue(createMockStats(hugeSize, 100));
      const corpusFd = createVirtualCorpusFd(hugeSize, false);
      vi.spyOn(fs.promises, 'open').mockResolvedValue(corpusFd);

      try {
        expect(await detectSortedness('/fake/huge.txt')).toBe('sorted');

        const calls = readCalls(corpusFd);
        expect(calls.length).toBeGreaterThan(0);
        const regionCount = computeRegionCount(hugeSize);
        const maxSingleRead = Math.max(...calls.map((c) => c[2]));
        const totalRequested = calls.reduce((sum, c) => sum + c[2], 0);

        // No read may be larger than the largest window, and the total is
        // bounded by N regions plus the two head/tail windows — proving no
        // allocation scales with corpus size.
        expect(maxSingleRead).toBeLessThanOrEqual(HEAD_TAIL_WINDOW_BYTES);
        expect(totalRequested).toBeLessThanOrEqual(
          regionCount * SORTEDNESS_REGION_READ_BYTES + 2 * HEAD_TAIL_WINDOW_BYTES,
        );
        // At the maximum stratum count, region samples dominate.
        expect(regionCount).toBe(SORTEDNESS_MAX_REGIONS);
      } finally {
        statSpy.mockRestore();
        vi.restoreAllMocks();
      }
    });

    it('never includes hash substrings in captured output (FR-015)', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const statSpy = vi.spyOn(fs.promises, 'stat')
        .mockResolvedValue(createMockStats(GIB, 100));
      vi.spyOn(fs.promises, 'open')
        .mockResolvedValue(createVirtualCorpusFd(GIB, false));

      try {
        expect(await detectSortedness('/fake/sorted.txt')).toBe('sorted');
        const output = [
          ...logSpy.mock.calls,
          ...errSpy.mock.calls,
          ...warnSpy.mock.calls,
        ]
          .flat().map(String).join('\n');
        expect(output).not.toMatch(/[0-9a-f]{40}/i);
      } finally {
        logSpy.mockRestore();
        errSpy.mockRestore();
        warnSpy.mockRestore();
        statSpy.mockRestore();
        vi.restoreAllMocks();
      }
    });
  });

  describe('.idx cache gate (V3)', () => {
    it('returns "sorted" from a fresh V3 .idx with the flag set — no corpus reads', async () => {
      const header = buildV3IdxHeader({ sorted: true, fileSize: GIB });
      const idxFd = headerReadFd(header);
      const corpusFd = createVirtualCorpusFd(GIB, false);

      const statSpy = vi.spyOn(fs.promises, 'stat').mockImplementation(async (p: fs.PathLike) => (
        String(p).endsWith('.idx')
          ? createMockStats(IDX_HEADER_SIZE, 300)
          : createMockStats(GIB, 100)
      ));
      const openSpy = vi.spyOn(fs.promises, 'open').mockImplementation(async (p: fs.PathLike) => (
        String(p).endsWith('.idx') ? idxFd : corpusFd
      ));

      try {
        expect(await detectSortedness('/fake/file.txt')).toBe('sorted');
        expect(openSpy).toHaveBeenCalledWith('/fake/file.txt.idx', 'r');
        expect(corpusFd.read).not.toHaveBeenCalled();
      } finally {
        statSpy.mockRestore();
        openSpy.mockRestore();
      }
    });

    it('returns "unsorted" from a fresh V3 .idx with the flag unset', async () => {
      const header = buildV3IdxHeader({ sorted: false, fileSize: GIB });
      const idxFd = headerReadFd(header);
      const corpusFd = createVirtualCorpusFd(GIB, false);

      const statSpy = vi.spyOn(fs.promises, 'stat').mockImplementation(async (p: fs.PathLike) => (
        String(p).endsWith('.idx')
          ? createMockStats(IDX_HEADER_SIZE, 300)
          : createMockStats(GIB, 100)
      ));
      vi.spyOn(fs.promises, 'open').mockImplementation(async (p: fs.PathLike) => (
        String(p).endsWith('.idx') ? idxFd : corpusFd
      ));

      try {
        expect(await detectSortedness('/fake/file.txt')).toBe('unsorted');
        expect(corpusFd.read).not.toHaveBeenCalled();
      } finally {
        statSpy.mockRestore();
        vi.restoreAllMocks();
      }
    });

    it('re-verifies live on a V2-stamped .idx even with fresh mtime and sorted flag (FR-008)', async () => {
      const header = buildV3IdxHeader({ sorted: true, fileSize: GIB });
      header[1] = IDX_VERSION_V2;
      const idxFd = headerReadFd(header);
      const corpusFd = createVirtualCorpusFd(GIB, false);

      const statSpy = vi.spyOn(fs.promises, 'stat').mockImplementation(async (p: fs.PathLike) => (
        String(p).endsWith('.idx')
          ? createMockStats(IDX_HEADER_SIZE, 300)
          : createMockStats(GIB, 100)
      ));
      vi.spyOn(fs.promises, 'open').mockImplementation(async (p: fs.PathLike) => (
        String(p).endsWith('.idx') ? idxFd : corpusFd
      ));

      try {
        expect(await detectSortedness('/fake/file.txt')).toBe('sorted');
        expect(corpusFd.read).toHaveBeenCalled();
      } finally {
        statSpy.mockRestore();
        vi.restoreAllMocks();
      }
    });

    it('re-verifies live when the .idx header is truncated', async () => {
      const truncatedFd = createMockFd(async (buf, off, length) => {
        Buffer.alloc(5).copy(buf, off, 0, Math.min(length, 5));
        return { bytesRead: 5, buffer: buf };
      });
      const corpusFd = createVirtualCorpusFd(GIB, false);

      const statSpy = vi.spyOn(fs.promises, 'stat').mockImplementation(async (p: fs.PathLike) => (
        String(p).endsWith('.idx')
          ? createMockStats(IDX_HEADER_SIZE, 300)
          : createMockStats(GIB, 100)
      ));
      vi.spyOn(fs.promises, 'open').mockImplementation(async (p: fs.PathLike) => (
        String(p).endsWith('.idx') ? truncatedFd : corpusFd
      ));

      try {
        expect(await detectSortedness('/fake/file.txt')).toBe('sorted');
        expect(corpusFd.read).toHaveBeenCalled();
      } finally {
        statSpy.mockRestore();
        vi.restoreAllMocks();
      }
    });

    it('re-verifies live when the .idx hash type does not match', async () => {
      const header = buildV3IdxHeader({ sorted: true, fileSize: GIB });
      header[2] = 2; // NTLM while fullHashLength says SHA-1
      const idxFd = headerReadFd(header);
      const corpusFd = createVirtualCorpusFd(GIB, false);

      const statSpy = vi.spyOn(fs.promises, 'stat').mockImplementation(async (p: fs.PathLike) => (
        String(p).endsWith('.idx')
          ? createMockStats(IDX_HEADER_SIZE, 300)
          : createMockStats(GIB, 100)
      ));
      vi.spyOn(fs.promises, 'open').mockImplementation(async (p: fs.PathLike) => (
        String(p).endsWith('.idx') ? idxFd : corpusFd
      ));

      try {
        expect(await detectSortedness('/fake/file.txt')).toBe('sorted');
        expect(corpusFd.read).toHaveBeenCalled();
      } finally {
        statSpy.mockRestore();
        vi.restoreAllMocks();
      }
    });

    it('re-verifies live when the .idx file size does not match the corpus', async () => {
      const header = buildV3IdxHeader({ sorted: true, fileSize: GIB + 1 });
      const idxFd = headerReadFd(header);
      const corpusFd = createVirtualCorpusFd(GIB, false);

      const statSpy = vi.spyOn(fs.promises, 'stat').mockImplementation(async (p: fs.PathLike) => (
        String(p).endsWith('.idx')
          ? createMockStats(IDX_HEADER_SIZE, 300)
          : createMockStats(GIB, 100)
      ));
      vi.spyOn(fs.promises, 'open').mockImplementation(async (p: fs.PathLike) => (
        String(p).endsWith('.idx') ? idxFd : corpusFd
      ));

      try {
        expect(await detectSortedness('/fake/file.txt')).toBe('sorted');
        expect(corpusFd.read).toHaveBeenCalled();
      } finally {
        statSpy.mockRestore();
        vi.restoreAllMocks();
      }
    });

    it('re-verifies live when the .idx mtime is not strictly newer than the corpus', async () => {
      const header = buildV3IdxHeader({ sorted: true, fileSize: GIB });
      const idxFd = headerReadFd(header);
      const corpusFd = createVirtualCorpusFd(GIB, false);

      const statSpy = vi.spyOn(fs.promises, 'stat').mockImplementation(async (p: fs.PathLike) => (
        String(p).endsWith('.idx')
          ? createMockStats(IDX_HEADER_SIZE, 100)
          : createMockStats(GIB, 100)
      ));
      vi.spyOn(fs.promises, 'open').mockImplementation(async (p: fs.PathLike) => (
        String(p).endsWith('.idx') ? idxFd : corpusFd
      ));

      try {
        expect(await detectSortedness('/fake/file.txt')).toBe('sorted');
        expect(corpusFd.read).toHaveBeenCalled();
      } finally {
        statSpy.mockRestore();
        vi.restoreAllMocks();
      }
    });
  });
});
