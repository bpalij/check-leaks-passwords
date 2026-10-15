import fs from 'fs';

import {
  MAX_LINE_BYTES,
  SORTEDNESS_MAX_REGIONS,
  SORTEDNESS_MIN_REGIONS,
  SORTEDNESS_REGION_READ_BYTES,
  SORTEDNESS_SAMPLE_STRATA_BYTES,
} from '../constants.js';

/**
 * Outcome of reading one deterministic stratum of the corpus.
 *
 * @property anchor - Hash of the first complete line after line-boundary
 *   alignment; the region's representative value for cross-region comparison.
 * @property adjacentInRegion - True when every consecutive pair of extractable
 *   hashes within the window is in non-decreasing order (FR-013).
 */
export interface RegionSample {
  anchor: string;
  adjacentInRegion: boolean;
}

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
 * Extract a hex hash from a line in the buffer.
 *
 * @param buf - Buffer containing the line.
 * @param lineStart - Start of the line.
 * @param lineEnd - End of the line (exclusive).
 * @param hashLength - Length of a full hex hash (40 for SHA-1, 32 for NTLM).
 * @returns The hex hash string, or null if the line is too short.
 */
function extractHash(
  buf: Buffer,
  lineStart: number,
  lineEnd: number,
  hashLength: number,
): string | null {
  if (lineEnd - lineStart < hashLength) return null;
  const end = lineEnd > lineStart && buf[lineEnd - 1] === 0x0D ? lineEnd - 1 : lineEnd;
  if (end - lineStart < hashLength) return null;
  return buf.toString('ascii', lineStart, lineStart + hashLength);
}

/**
 * Check whether complete lines in a buffer are sorted in ascending hash order.
 *
 * Lines shorter than `hashLength` are skipped, matching the corpus parser's
 * handling of malformed lines.
 *
 * @param buf - The buffer containing hash lines.
 * @param hashLength - Length of a full hex hash (40 for SHA-1, 32 for NTLM).
 * @returns True if all consecutive extractable hash pairs are non-decreasing.
 */
export function checkBufferSorted(buf: Buffer, hashLength: number): boolean {
  let lineStart = 0;
  let prevHash: string | null = null;
  const len = buf.length;

  while (lineStart < len) {
    const nl = findNewline(buf, lineStart, len);
    const lineEnd = nl === -1 ? len : nl;

    if (lineEnd - lineStart >= hashLength) {
      const hash = extractHash(buf, lineStart, lineEnd, hashLength);
      if (hash !== null) {
        if (prevHash !== null && prevHash > hash) return false;
        prevHash = hash;
      }
    }

    if (nl === -1) break;
    lineStart = nl + 1;
  }

  return true;
}

/**
 * Check whether complete lines in a window starting at an arbitrary byte
 * offset are sorted in ascending hash order.
 *
 * The partial first line is skipped: its fragment can be at least
 * `hashLength` bytes long and would yield a bogus hash that breaks adjacent
 * comparisons even when the corpus is genuinely sorted.
 *
 * @param buf - The window buffer (may start mid-line).
 * @param hashLength - Length of a full hex hash (40 for SHA-1, 32 for NTLM).
 * @returns True if all consecutive complete-line hash pairs are non-decreasing;
 *   true when the window contains no complete line (nothing to verify).
 */
export function checkAlignedWindowSorted(buf: Buffer, hashLength: number): boolean {
  const firstNewline = findNewline(buf, 0, buf.length);
  if (firstNewline === -1) return true;
  return checkBufferSorted(buf.subarray(firstNewline + 1), hashLength);
}

/**
 * Compute the deterministic region count for a corpus size.
 *
 * N = clamp(ceil(fileSize / SORTEDNESS_SAMPLE_STRATA_BYTES),
 * SORTEDNESS_MIN_REGIONS, SORTEDNESS_MAX_REGIONS) — pure and I/O-free, so
 * identical sizes always yield identical counts (FR-002, FR-010).
 *
 * @param fileSize - Corpus size in bytes.
 * @returns The clamped region count in [20, 256].
 */
export function computeRegionCount(fileSize: number): number {
  const raw = Math.ceil(fileSize / SORTEDNESS_SAMPLE_STRATA_BYTES);
  return Math.min(SORTEDNESS_MAX_REGIONS, Math.max(SORTEDNESS_MIN_REGIONS, raw));
}

/**
 * Compute the deterministic evenly spaced sample offsets for a corpus.
 *
 * offset[i] = floor(i * fileSize / count); the first offset is always 0.
 * Pure and I/O-free: identical inputs yield identical outputs (FR-002, FR-010).
 *
 * @param fileSize - Corpus size in bytes.
 * @param count - Region count (from {@link computeRegionCount}).
 * @returns Array of `count` read-window start offsets.
 * @throws {Error} If `count` is not a positive integer.
 */
export function computeSampleOffsets(fileSize: number, count: number): number[] {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`computeSampleOffsets: count must be a positive integer, got ${count}`);
  }
  const offsets: number[] = new Array(count);
  for (let i = 0; i < count; i += 1) {
    offsets[i] = Math.floor((i * fileSize) / count);
  }
  return offsets;
}

/**
 * Enforce the runtime non-overlap invariant before sampling.
 *
 * Requires fileSize >= count * max(SORTEDNESS_REGION_READ_BYTES, MAX_LINE_BYTES)
 * so no two region windows can overlap or straddle the same maximum-length line
 * (FR-012, SC-007). Violation is a detected invalid state, never silently
 * clamped.
 *
 * @param fileSize - Corpus size in bytes.
 * @param count - Region count about to be sampled.
 * @throws {Error} If the invariant is violated; the message names the invariant.
 */
export function assertNonOverlapInvariant(fileSize: number, count: number): void {
  const minSpacing = Math.max(SORTEDNESS_REGION_READ_BYTES, MAX_LINE_BYTES);
  if (fileSize < count * minSpacing) {
    throw new Error(
      `sortedness non-overlap invariant violated: fileSize ${fileSize} < `
      + `${count} * max(SORTEDNESS_REGION_READ_BYTES, MAX_LINE_BYTES) = ${count * minSpacing}`,
    );
  }
}

/**
 * Read one deterministic region sample from an open corpus file.
 *
 * Skips the partial first line (the window starts at an arbitrary byte offset),
 * verifies intra-region adjacency across every complete line in the window
 * (FR-013), and returns the first complete line's hash as the region anchor.
 *
 * @param fd - Open read handle for the corpus.
 * @param offset - Window start offset (from {@link computeSampleOffsets}).
 * @param hashLength - Length of a full hex hash (40 for SHA-1, 32 for NTLM).
 * @returns The region anchor and intra-region adjacency result.
 * @throws {Error} If the window contains no complete line (or none long enough
 *   to yield a hash) — an explicit failure, never a silent pass (contract §5).
 * @security Reads password hashes; never log the returned anchor or line content.
 */
export async function readRegionSample(
  fd: fs.promises.FileHandle,
  offset: number,
  hashLength: number,
): Promise<RegionSample> {
  const buf = Buffer.alloc(SORTEDNESS_REGION_READ_BYTES);
  const { bytesRead } = await fd.read(buf, 0, SORTEDNESS_REGION_READ_BYTES, offset);
  const window = buf.subarray(0, bytesRead);

  // Skip the partial first line: the offset lands mid-file, so the first
  // terminated line may begin before the window. Anchors must come from
  // complete lines only.
  const firstNewline = findNewline(window, 0, window.length);
  if (firstNewline === -1) {
    throw new Error(
      `sortedness region window at offset ${offset} contains no complete line`,
    );
  }

  let anchor: string | null = null;
  let prevHash: string | null = null;
  let adjacentInRegion = true;
  let lineStart = firstNewline + 1;

  for (;;) {
    const nl = findNewline(window, lineStart, window.length);
    if (nl === -1) break; // trailing partial line — not a complete line

    const hash = extractHash(window, lineStart, nl, hashLength);
    if (hash !== null) {
      if (anchor === null) anchor = hash;
      if (prevHash !== null && prevHash > hash) adjacentInRegion = false;
      prevHash = hash;
    }
    lineStart = nl + 1;
  }

  if (anchor === null) {
    throw new Error(
      `sortedness region window at offset ${offset} contains no complete line `
      + 'with an extractable hash',
    );
  }

  return { anchor, adjacentInRegion };
}
