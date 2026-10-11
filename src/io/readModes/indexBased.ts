import fs from 'fs';
import os from 'os';

import { groupHashesByPrefix } from '../../hashing/groupByPrefix.js';
import {
  SHA1_HEX_LENGTH,
  MAX_INDEX_READER_CONCURRENCY,
  INDEX_PREFIX_LENGTH,
} from '../../constants.js';
import { parseBuffer } from '../../hashing/parseBuffer.js';
import { promisePool } from '../promisePool.js';
import { getAvailableMemBytes } from '../../memory/getAvailableMemBytes.js';
import { createSpeedTracker } from '../speedTracker.js';
import { parseEnvInt } from '../../memory/parseEnvInt.js';
import type {
  PasswordObject,
  HashWithLeaksAndPasswordObjects,
  HashLookupEntry,
  OnProgress,
} from '../../types.js';
import { formatCompact } from '../../formatting/formatCompact.js';
import { formatNumber } from '../../formatting/formatNumber.js';
import { formatBytes } from '../../formatting/formatBytes.js';
import { formatDuration } from '../../formatting/formatDuration.js';
import { enrichWithPasswordObjects } from '../../enrichResults.js';

/**
 * Index-based reader using a pre-built `.idx` file.
 *
 * Uses the index to jump directly to each prefix's byte range in the
 * HIBP file, avoiding a full sequential scan. Each prefix block is read
 * and parsed in parallel (SSD) or serially (HDD).
 *
 * @param filePath - Path to the HIBP hashes file.
 * @param fileSize - Size of the file in bytes.
 * @param hashLookupMap - Map from 4-byte key to candidate hash entries.
 * @param fingerprintSet - Optional fingerprint set for fast rejection.
 * @param encoding - Buffer encoding for hash comparison.
 * @param idx - Pre-loaded index array (offsets by prefix).
 * @param hashesWithPasswordObjects - Map from SHA-1 hex hash to password objects.
 * @param logger - Optional logging callback.
 * @param onProgress - Optional progress callback.
 * @param isHDD - Whether the drive is an HDD (limits concurrency).
 * @returns Enriched results with leak counts and password objects.
 *
 * @security Handles SHA-1 hash maps derived from passwords — treat as sensitive.
 */
export async function indexReader(
  filePath: string,
  fileSize: number,
  hashLookupMap: Map<number, HashLookupEntry[]>,
  fingerprintSet: Set<number> | null,
  encoding: BufferEncoding,
  idx: BigUint64Array,
  hashesWithPasswordObjects: Map<string, Array<PasswordObject>>,
  logger?: (message: string) => void,
  onProgress?: OnProgress,
  isHDD?: boolean,
): Promise<Array<HashWithLeaksAndPasswordObjects>> {
  const irStartInstant = Temporal.Now.instant();
  const speedTracker = createSpeedTracker();
  const grouped = groupHashesByPrefix(hashesWithPasswordObjects, INDEX_PREFIX_LENGTH);

  const ranges: Array<{
    start: bigint;
    end: bigint;
    prefix: number;
    entries: HashLookupEntry[];
  }> = [];
  grouped.forEach((group, prefixStr) => {
    const prefix = parseInt(prefixStr, 16);
    const entries: HashLookupEntry[] = [];
    group.map.forEach((arr) => entries.push(...arr));
    ranges.push({
      start: idx[prefix],
      end: idx[prefix + 1],
      prefix,
      entries,
    });
  });

  if (logger) {
    logger(`Index read: reading ${ranges.length} prefix blocks...`);
  }

  // Sort by file offset for sequential I/O pattern
  ranges.sort((a, b) => {
    if (a.start < b.start) return -1;
    if (a.start > b.start) return 1;
    return 0;
  });

  const memoryCap = Math.max(1, Math.floor(getAvailableMemBytes() / (2 * 1024 * 1024)));
  const envConcurrency = parseEnvInt('INDEX_READER_CONCURRENCY', 1, MAX_INDEX_READER_CONCURRENCY, NaN, logger);
  let maxConcurrency: number;
  if (Number.isFinite(envConcurrency)) {
    maxConcurrency = Math.min(ranges.length, envConcurrency);
  } else if (isHDD) {
    maxConcurrency = 1;
  } else {
    maxConcurrency = Math.min(ranges.length, os.availableParallelism() * 2, memoryCap);
  }

  if (isHDD && logger) {
    logger('HDD detected, using 1 worker');
  } else if (!isHDD && logger && ranges.length > 0) {
    logger(`SSD/NVMe detected (concurrency: ${maxConcurrency})`);
  }

  const totalBytesToRead = ranges.reduce((sum, r) => sum + Number(r.end - r.start), 0);
  const totalBytesRead = { value: 0 };
  const allResults: Array<{ hash: string; leaks: number }> = [];
  let totalMatched = 0;
  let totalLeaks = 0;

  await using fd = await fs.promises.open(filePath, 'r');

  const poolResults = await promisePool(ranges, maxConcurrency, async (range) => {
    const length = Number(range.end - range.start);
    if (length === 0) {
      return { results: [], matchedHashCount: 0, cumulativeLeakCount: 0 };
    }

    const buf = Buffer.allocUnsafe(length);
    await fd.read(buf, 0, length, Number(range.start));
    totalBytesRead.value += length;

    // Build a sub-map for just this prefix's entries
    const subMap = new Map<number, HashLookupEntry[]>();
    range.entries.forEach((entry) => {
      const key1 = entry.fullHashBytes.readUInt32BE(0);
      subMap.getOrInsert(key1, []).push(entry as HashLookupEntry);
    });

    const { stats, results } = parseBuffer(
      buf,
      SHA1_HEX_LENGTH,
      subMap,
      fingerprintSet,
      encoding,
    );

    onProgress?.({
      current: totalBytesRead.value,
      total: totalBytesToRead,
      speed: speedTracker.record(totalBytesRead.value),
      format: 'bytes',
    });
    return {
      results,
      matchedHashCount: stats.matchedHashCount,
      cumulativeLeakCount: stats.cumulativeLeakCount,
    };
  });

  poolResults.forEach((r) => {
    allResults.push(...r.results);
    totalMatched += r.matchedHashCount;
    totalLeaks += r.cumulativeLeakCount;
  });

  const enriched = enrichWithPasswordObjects(allResults, hashesWithPasswordObjects);

  if (logger) {
    const elapsedMs = Date.now() - irStartInstant.epochMilliseconds;
    const throughput = elapsedMs > 0 ? Math.round(totalBytesRead.value / (elapsedMs / 1000)) : 0;
    logger(`Index read complete. Found ${formatNumber(totalMatched)} hashes with total ${formatNumber(totalLeaks)} (${formatCompact(totalLeaks)}) leaks`);
    logger(`Processing ${formatBytes(throughput)}/s avg throughput`);
    logger(`Checked passwords in ${formatDuration(irStartInstant, Temporal.Now.instant())}`);
  }

  return enriched;
}
