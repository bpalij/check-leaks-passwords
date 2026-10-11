/* eslint-disable no-param-reassign */
import fs from 'fs';
import os from 'os';

import { SHA1_HEX_LENGTH, BINARY_SEARCH_READ_SIZE } from '../../constants.js';
import type {
  PasswordObject,
  HashWithLeaksAndPasswordObjects,
  HashLookupEntry,
  OnProgress,
} from '../../types.js';
import { formatCompact } from '../../formatting/formatCompact.js';
import { formatNumber } from '../../formatting/formatNumber.js';
import { formatDuration } from '../../formatting/formatDuration.js';
import { promisePool } from '../promisePool.js';
import { getAvailableMemBytes } from '../../memory/getAvailableMemBytes.js';
import { createSpeedTracker } from '../speedTracker.js';
import { enrichWithPasswordObjects } from '../../enrichResults.js';

const NEWLINE = 0x0A;
const CARRIAGE_RETURN = 0x0D;
const COLON = 0x3A;

/** Maximum number of entries in the read cache (LRU eviction). */
export const cacheConfig = { maxEntries: 10000 } as const;

/**
 * Internal state for a single binary search operation.
 *
 * Tracks the search range [low, high] and the resolved result.
 */
interface SearchState {
  fullHash: string;
  targetBytes: Buffer;
  low: number;
  high: number;
  result: number | null;
}

/**
 * Find the first newline (LF or CR) in a buffer.
 *
 * @param buf - The buffer to search.
 * @returns Index of the first newline, or -1 if not found.
 */
export function findFirstNewline(buf: Buffer): number {
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] === NEWLINE || buf[i] === CARRIAGE_RETURN) {
      return i;
    }
  }
  return -1;
}

/**
 * Find the first colon in a buffer range.
 *
 * @param buf - The buffer to search.
 * @param start - Start position.
 * @param end - End position (exclusive).
 * @returns Index of the first colon, or -1 if not found.
 */
export function findColon(buf: Buffer, start: number, end: number): number {
  for (let i = start; i < end; i += 1) {
    if (buf[i] === COLON) return i;
  }
  return -1;
}

/**
 * Parse the leak count from a HIBP line after the colon.
 *
 * @param buf - The buffer containing the line.
 * @param start - Start of the number (after colon).
 * @param end - End of the number (before newline).
 * @returns Parsed leak count, or 0 if invalid.
 */
function parseLeaks(buf: Buffer, start: number, end: number): number {
  let i = start;
  while (i < end && buf[i] !== NEWLINE && buf[i] !== CARRIAGE_RETURN) i += 1;
  const numStr = buf.toString('ascii', start, i);
  const n = parseInt(numStr, 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Binary search reader for sorted HIBP files.
 *
 * Performs binary search on the sorted file for each hash, using
 * concurrent reads and an LRU read cache. Batches nearby reads
 * into coalesced I/O operations for better throughput.
 *
 * @param filePath - Path to the HIBP hashes file.
 * @param fileSize - Size of the file in bytes.
 * @param hashLookupMap - Map from 4-byte key to candidate hash entries.
 * @param fingerprintSet - Optional fingerprint set for fast rejection.
 * @param encoding - Buffer encoding for hash comparison.
 * @param hashesWithPasswordObjects - Map from SHA-1 hex hash to password objects.
 * @param logger - Optional logging callback.
 * @param onProgress - Optional progress callback.
 * @returns Enriched results with leak counts and password objects.
 *
 * @security Handles SHA-1 hash maps derived from passwords — treat as sensitive.
 */
export async function binarySearchReader(
  filePath: string,
  fileSize: number,
  hashLookupMap: Map<number, HashLookupEntry[]>,
  fingerprintSet: Set<number> | null,
  encoding: BufferEncoding,
  hashesWithPasswordObjects: Map<string, Array<PasswordObject>>,
  logger?: (message: string) => void,
  onProgress?: OnProgress,
): Promise<Array<HashWithLeaksAndPasswordObjects>> {
  const bsStartInstant = Temporal.Now.instant();
  const speedTracker = createSpeedTracker();
  const seenHashes = new Set<string>();
  const states: SearchState[] = [];

  hashLookupMap.forEach((entries) => {
    entries.forEach((entry) => {
      if (!seenHashes.has(entry.fullHash)) {
        seenHashes.add(entry.fullHash);
        states.push({
          fullHash: entry.fullHash,
          targetBytes: Buffer.from(entry.fullHash, 'ascii'),
          low: 0,
          high: fileSize,
          result: null,
        });
      }
    });
  });

  states.sort((a, b) => a.fullHash.localeCompare(b.fullHash));

  if (logger) {
    logger(`Binary search: checking ${states.length} hashes...`);
  }

  if (states.length === 0) {
    return [];
  }

  const CACHE_MEMORY_BYTES = (cacheConfig.maxEntries * BINARY_SEARCH_READ_SIZE) * 2;
  const PER_OP_BYTES = (BINARY_SEARCH_READ_SIZE + 512) * 2;

  const availableMem = getAvailableMemBytes();
  const memForConcurrency = Math.max(0, availableMem - CACHE_MEMORY_BYTES);
  const concurrency = Math.min(
    states.length,
    os.availableParallelism() * 2,
    Math.max(1, Math.floor(memForConcurrency / PER_OP_BYTES)),
  );

  const readCache = new Map<number, Buffer>();

  await using fd = await fs.promises.open(filePath, 'r');

  /**
   * Read from file with LRU caching.
   *
   * On cache hit, promotes the entry to MRU position.
   * On cache miss, evicts the oldest entry if at capacity.
   *
   * @param readPos - File position to read from.
   * @returns The read buffer (trimmed to bytes actually read).
   */
  const getOrRead = async (readPos: number): Promise<Buffer> => {
    const cached = readCache.get(readPos);
    if (cached) {
      readCache.delete(readPos);
      readCache.set(readPos, cached);
      return cached;
    }

    try {
      const buf = Buffer.allocUnsafe(BINARY_SEARCH_READ_SIZE);
      const { bytesRead } = await fd.read(buf, 0, BINARY_SEARCH_READ_SIZE, readPos);
      const trimmed = buf.subarray(0, bytesRead);
      if (readCache.size >= cacheConfig.maxEntries) {
        // Map preserves insertion order — first key is the oldest (LRU) entry
        const firstKey = readCache.keys().next().value as number;
        readCache.delete(firstKey);
      }
      readCache.set(readPos, trimmed);
      return trimmed;
    } catch (err) {
      logger?.(`Warning: read at position ${readPos} failed: ${err}`);
      throw err;
    }
  };

  let unresolvedCount = states.length;

  /**
   * Process a single binary search step for one hash.
   *
   * Reads a window around the midpoint, finds the line boundary,
   * extracts the hash, and compares with the target. Adjusts the
   * search range based on comparison result.
   *
   * @param state - Current search state for this hash.
   * @param mid - Current midpoint byte offset.
   * @param readPos - Absolute read position in the file.
   * @param trimmed - Buffer containing the read window.
   * @param groupReadPos - Start byte offset of the current chunk.
   */
  const processItem = (
    state: SearchState,
    mid: number,
    readPos: number,
    trimmed: Buffer,
    groupReadPos: number,
  ) => {
    const offset = readPos - groupReadPos;
    if (trimmed.length - offset < SHA1_HEX_LENGTH) {
      state.high = mid;
      return;
    }

    let lineStart: number;
    if (readPos === 0) {
      lineStart = 0;
    } else {
      const nl = findFirstNewline(trimmed.subarray(offset));
      if (nl === -1) {
        state.low = mid + 1;
        return;
      }
      lineStart = offset + nl + 1;
    }

    if (
      trimmed[lineStart] === NEWLINE
      || trimmed[lineStart] === CARRIAGE_RETURN
      || trimmed.length - lineStart < SHA1_HEX_LENGTH
    ) {
      state.low = mid + 1;
      return;
    }

    const colonIdx = findColon(trimmed, lineStart, trimmed.length);
    if (colonIdx === -1) {
      state.low = mid + 1;
      return;
    }

    const sub = trimmed.subarray(lineStart, lineStart + SHA1_HEX_LENGTH);
    const cmp = Buffer.compare(sub, state.targetBytes);

    if (cmp === 0) {
      const leaks = parseLeaks(trimmed, colonIdx + 1, trimmed.length);
      state.result = leaks;
      unresolvedCount -= 1;
    } else if (cmp > 0) {
      state.high = mid;
    } else {
      state.low = state.low === mid ? state.high : mid;
    }
  };

  for (let iteration = 0; unresolvedCount > 0; iteration += 1) {
    const active: SearchState[] = [];
    let hasRange = false;
    states.forEach((s) => {
      if (s.result === null) {
        active.push(s);
        if (s.high - s.low > 0) hasRange = true;
      }
    });
    if (active.length === 0 || !hasRange) break;

    const resolved = states.length - active.length;
    onProgress?.({
      current: resolved,
      total: states.length,
      speed: speedTracker.record(resolved),
      phase: 'Binary search',
      format: 'number',
    });

    // Calculate read positions for each active search
    const reads = active.map((state) => {
      const mid = Math.floor((state.low + state.high) / 2);
      const readPos = Math.max(0, mid - Math.floor(BINARY_SEARCH_READ_SIZE / 2));
      return { state, mid, readPos };
    });

    reads.sort((a, b) => a.readPos - b.readPos);

    // Coalesce overlapping reads into larger I/O operations
    const coalesced: Array<{
      readPos: number;
      readLen: number;
      items: typeof reads;
    }> = [];
    reads.forEach((read) => {
      const last = coalesced[coalesced.length - 1];
      if (last && read.readPos < last.readPos + last.readLen) {
        const neededEnd = read.readPos + BINARY_SEARCH_READ_SIZE;
        if (neededEnd > last.readPos + last.readLen) {
          last.readLen = neededEnd - last.readPos;
        }
        last.items.push(read);
      } else {
        coalesced.push({
          readPos: read.readPos,
          readLen: BINARY_SEARCH_READ_SIZE,
          items: [read],
        });
      }
    });

    // eslint-disable-next-line no-await-in-loop
    await promisePool(coalesced, concurrency, async (group) => {
      let trimmed: Buffer;
      if (group.readLen === BINARY_SEARCH_READ_SIZE) {
        trimmed = await getOrRead(group.readPos);
      } else {
        const buf = Buffer.allocUnsafe(group.readLen);
        const { bytesRead } = await fd.read(buf, 0, group.readLen, group.readPos);
        trimmed = buf.subarray(0, bytesRead);
      }

      group.items.forEach(({ state: s, mid, readPos }) => {
        processItem(s, mid, readPos, trimmed, group.readPos);
      });
    });
  }

  onProgress?.({
    current: states.length,
    total: states.length,
    speed: speedTracker.record(states.length),
    phase: 'Binary search',
    format: 'number',
  });

  const found = states
    .filter((s) => s.result !== null)
    .map((s) => ({ hash: s.fullHash, leaks: s.result! }));

  if (logger) {
    const totalLeaks = found.reduce((sum, r) => sum + r.leaks, 0);
    const elapsedMs = Date.now() - bsStartInstant.epochMilliseconds;
    const hashesPerSec = elapsedMs > 0 ? Math.round(states.length / (elapsedMs / 1000)) : 0;
    logger(`Binary search complete. Found ${formatNumber(found.length)} hashes with total ${formatNumber(totalLeaks)} (${formatCompact(totalLeaks)}) leaks`);
    logger(`Processing ${formatNumber(hashesPerSec)} hashes/s avg throughput`);
    logger(`Checked passwords in ${formatDuration(bsStartInstant, Temporal.Now.instant())}`);
  }

  const enriched = enrichWithPasswordObjects(found, hashesWithPasswordObjects);

  return enriched;
}
