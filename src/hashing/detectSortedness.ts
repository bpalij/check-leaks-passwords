/* eslint-disable no-continue */
import fs from 'fs';

import {
  IDX_HEADER_SIZE,
  IDX_SORTED_FLAG_OK,
  SORTEDNESS_CHECK_PAIRS,
  SHA1_HEX_LENGTH,
} from '../constants.js';

/**
 * Find the next newline character in a buffer.
 *
 * @param buf - The buffer to search.
 * @param start - Start position.
 * @param end - End position (exclusive).
 * @returns Index of the first 0x0A byte, or -1 if not found.
 */
function findNewline(buf: Buffer, start: number, end: number): number {
  for (let i = start; i < end; i += 1) {
    if (buf[i] === 0x0A) return i;
  }
  return -1;
}

/**
 * Extract a SHA-1 hex hash from a line in the buffer.
 *
 * @param buf - The buffer containing the line.
 * @param lineStart - Start of the line.
 * @param lineEnd - End of the line (exclusive).
 * @returns The 40-character hex hash string, or null if the line is too short.
 */
function extractHash(buf: Buffer, lineStart: number, lineEnd: number): string | null {
  if (lineEnd - lineStart < SHA1_HEX_LENGTH) return null;
  const end = lineEnd > lineStart && buf[lineEnd - 1] === 0x0D ? lineEnd - 1 : lineEnd;
  if (end - lineStart < SHA1_HEX_LENGTH) return null;
  return buf.toString('ascii', lineStart, lineStart + SHA1_HEX_LENGTH);
}

/**
 * Check if lines in a buffer are sorted in ascending hash order.
 *
 * Used by `detectSortedness()` to verify sortedness of HIBP file segments.
 *
 * @param buf - The buffer containing hash lines.
 * @returns True if all consecutive hash pairs are in non-decreasing order.
 */
function checkBufferSorted(buf: Buffer): boolean {
  let lineStart = 0;
  let prevHash: string | null = null;
  const len = buf.length;

  while (lineStart < len) {
    const nl = findNewline(buf, lineStart, len);
    const lineEnd = nl === -1 ? len : nl;

    if (lineEnd - lineStart >= SHA1_HEX_LENGTH) {
      const hash = extractHash(buf, lineStart, lineEnd);
      if (hash === null) {
        lineStart = nl === -1 ? len : nl + 1;
        continue;
      }
      if (prevHash !== null && prevHash > hash) return false;
      prevHash = hash;
    }

    if (nl === -1) break;
    lineStart = nl + 1;
  }

  return true;
}

/**
 * Skip forward to the next line start (after a newline).
 *
 * @param buf - The buffer to search.
 * @param start - Start position.
 * @param end - End position (exclusive).
 * @returns Index after the next newline, or -1 if no newline found.
 */
function skipToLineStart(buf: Buffer, start: number, end: number): number {
  for (let i = start; i < end; i += 1) {
    if (buf[i] === 0x0A) return i + 1;
  }
  return -1;
}

/**
 * Detect whether a HIBP file is sorted in ascending SHA-1 hex order.
 *
 * Uses a three-phase approach:
 * 1. Check first 100 lines from start.
 * 2. Check last 100 lines near end.
 * 3. Check 20 random position pairs throughout the file.
 *
 * Also checks the `.idx` cache file for a pre-computed sortedness flag.
 *
 * @param filePath - Path to the HIBP hashes file.
 * @returns True if the file appears to be sorted.
 */
export async function detectSortedness(filePath: string): Promise<boolean> {
  const stat = await fs.promises.stat(filePath);
  const fileSize = stat.size;

  if (fileSize < SHA1_HEX_LENGTH + 5) return false;

  // Check .idx cache — if a fresh index exists, read the sorted flag
  const idxPath = `${filePath}.idx`;
  try {
    const idxStat = await fs.promises.stat(idxPath);
    if (idxStat.mtimeMs > stat.mtimeMs) {
      await using fd = await fs.promises.open(idxPath, 'r');
      const header = Buffer.alloc(IDX_HEADER_SIZE);
      await fd.read(header, 0, IDX_HEADER_SIZE, 0);
      // eslint-disable-next-line no-bitwise
      return (header[0] & IDX_SORTED_FLAG_OK) !== 0;
    }
  } catch { /* .idx file not found */ }

  await using fd = await fs.promises.open(filePath, 'r');

  // Phase 1: Check first 100 lines from start
  const startBytes = Math.min(100 * 80, fileSize);
  const startBuf = Buffer.alloc(startBytes);
  const { bytesRead: startRead } = await fd.read(startBuf, 0, startBytes, 0);
  if (!checkBufferSorted(startBuf.subarray(0, startRead))) return false;

  // Phase 2: Check last 100 lines near end
  const endBytes = Math.min(100 * 80, fileSize);
  const endBuf = Buffer.alloc(endBytes);
  const { bytesRead: endRead } = await fd.read(endBuf, 0, endBytes, fileSize - endBytes);
  if (!checkBufferSorted(endBuf.subarray(0, endRead))) return false;

  // Phase 3: Random positions — spot-check sortedness at random file offsets
  const buf = Buffer.alloc(512);
  for (let i = 0; i < SORTEDNESS_CHECK_PAIRS; i += 1) {
    const maxStart = Math.max(1, fileSize - 512);
    const pos = Math.floor(Math.random() * maxStart);
    // eslint-disable-next-line no-await-in-loop
    const { bytesRead } = await fd.read(buf, 0, 256, pos);
    if (bytesRead < SHA1_HEX_LENGTH * 2 + 5) { continue; }

    const lineStart = skipToLineStart(buf, 0, bytesRead);
    if (lineStart === -1 || bytesRead - lineStart < SHA1_HEX_LENGTH * 2 + 5) {
      continue;
    }

    const nl1 = findNewline(buf, lineStart, bytesRead);
    if (nl1 === -1) { continue; }
    const hash1 = extractHash(buf, lineStart, nl1);
    if (!hash1) { continue; }

    const nl2 = findNewline(buf, nl1 + 1, bytesRead);
    if (nl2 === -1) { continue; }
    const hash2 = extractHash(buf, nl1 + 1, nl2);
    if (!hash2) { continue; }

    if (hash1 > hash2) return false;
  }

  return true;
}
