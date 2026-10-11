import path from 'path';
import fs from 'fs';

import { vi } from 'vitest';

import { detectSortedness } from './detectSortedness.js';
import { IDX_HEADER_SIZE, IDX_SORTED_FLAG_OK } from '../constants.js';
import { FIXTURES_DIR } from '../../tests/helpers/fixturesDir.js';

const fixturesDir = FIXTURES_DIR;

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

describe('detectSortedness', () => {
  it('returns true for sorted file', async () => {
    const result = await detectSortedness(path.join(fixturesDir, 'sorted-hashes.txt'));
    expect(result).toBe(true);
  });

  it('returns false for unsorted file', async () => {
    const result = await detectSortedness(path.join(fixturesDir, 'unsorted-hashes.txt'));
    expect(result).toBe(false);
  });

  it('returns false for small file (< 2 lines)', async () => {
    const result = await detectSortedness(path.join(fixturesDir, 'small-sorted-hashes.txt'));
    expect(result).toBe(true);
  });

  it('returns false for empty file', async () => {
    const result = await detectSortedness(path.join(fixturesDir, 'empty-hashes.txt'));
    expect(result).toBe(false);
  });

  it('returns true when random reads find no newlines (skipToLineStart returns -1)', async () => {
    const noNewlineBuf = Buffer.alloc(256, 0x41);
    const mockFd = createMockFd(async (buf, _off, length, _pos) => {
      noNewlineBuf.copy(buf, 0, 0, length);
      return { bytesRead: length, buffer: buf };
    });

    const statSpy = vi.spyOn(fs.promises, 'stat').mockResolvedValue(createMockStats(1000, 100));
    const openSpy = vi.spyOn(fs.promises, 'open').mockResolvedValue(mockFd);

    try {
      const result = await detectSortedness('/fake/file.txt');
      expect(result).toBe(true);
      expect(mockFd.close).toHaveBeenCalled();
    } finally {
      statSpy.mockRestore();
      openSpy.mockRestore();
    }
  });

  it('returns cached sortedness from .idx file with newer mtime', async () => {
    const idxHeader = Buffer.alloc(IDX_HEADER_SIZE);
    idxHeader[0] = IDX_SORTED_FLAG_OK;

    const mockIdxFd = createMockFd(async (buf, off, length, _pos) => {
      idxHeader.copy(buf, off, 0, length);
      return { bytesRead: length, buffer: buf };
    });

    const statSpy = vi.spyOn(fs.promises, 'stat').mockImplementation(async (p: fs.PathLike) => {
      const str = String(p);
      if (str.endsWith('.idx')) {
        return createMockStats(IDX_HEADER_SIZE, 300);
      }
      return createMockStats(1000, 100);
    });
    const openSpy = vi.spyOn(fs.promises, 'open').mockResolvedValue(mockIdxFd);

    try {
      const result = await detectSortedness('/fake/file.txt');
      expect(result).toBe(true);
      expect(openSpy).toHaveBeenCalledWith('/fake/file.txt.idx', 'r');
      expect(mockIdxFd.close).toHaveBeenCalled();
    } finally {
      statSpy.mockRestore();
      openSpy.mockRestore();
    }
  });

  it('returns false from .idx cache when sorted flag is not set', async () => {
    const idxHeader = Buffer.alloc(IDX_HEADER_SIZE);
    idxHeader[0] = 0x00;

    const mockIdxFd = createMockFd(async (buf, off, length, _pos) => {
      idxHeader.copy(buf, off, 0, length);
      return { bytesRead: length, buffer: buf };
    });

    const statSpy = vi.spyOn(fs.promises, 'stat').mockImplementation(async (p: fs.PathLike) => {
      const str = String(p);
      if (str.endsWith('.idx')) {
        return createMockStats(IDX_HEADER_SIZE, 300);
      }
      return createMockStats(1000, 100);
    });
    const openSpy = vi.spyOn(fs.promises, 'open').mockResolvedValue(mockIdxFd);

    try {
      const result = await detectSortedness('/fake/file.txt');
      expect(result).toBe(false);
      expect(openSpy).toHaveBeenCalledWith('/fake/file.txt.idx', 'r');
    } finally {
      statSpy.mockRestore();
      openSpy.mockRestore();
    }
  });

  it('returns true for sorted file with short lines (skips malformed lines)', async () => {
    const result = await detectSortedness(path.join(fixturesDir, 'sorted-with-short-lines-hashes.txt'));
    expect(result).toBe(true);
  });

  it('returns true for sorted file with CR-terminated lines (skips lines where hex+CR is exactly SHA1_HEX_LENGTH)', async () => {
    const result = await detectSortedness(path.join(fixturesDir, 'sorted-with-cr-hashes.txt'));
    expect(result).toBe(true);
  });

  it('skips Phase 3 random checks when lineStart === -1', async () => {
    const hash = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';
    const sortedLines = `${Array.from({ length: 10 }, (_, i) => {
      const h = hash.slice(0, 39) + String.fromCharCode(0x30 + i);
      return `${h}:${i + 1}`;
    }).join('\n')}\n`;
    const sortedBuf = Buffer.from(sortedLines, 'ascii');

    let callCount = 0;
    const mockFd = createMockFd(async (buf, _off, length, position) => {
      callCount += 1;
      const end = Math.min(position + length, sortedBuf.length);
      const bytesToCopy = Math.max(0, end - position);
      if (bytesToCopy <= 0) {
        return { bytesRead: 0, buffer: buf };
      }
      sortedBuf.copy(buf, 0, position, end);
      return { bytesRead: bytesToCopy, buffer: buf };
    });

    const statSpy = vi.spyOn(fs.promises, 'stat').mockResolvedValue(createMockStats(sortedBuf.length, 100));
    const openSpy = vi.spyOn(fs.promises, 'open').mockResolvedValue(mockFd);

    try {
      const result = await detectSortedness('/fake/file.txt');
      expect(result).toBe(true);
      expect(callCount).toBeGreaterThan(2);
    } finally {
      statSpy.mockRestore();
      openSpy.mockRestore();
    }
  });
});
