import fs from 'fs';
import os from 'os';
import path from 'path';

import type { Ora } from 'ora';

import { createSpinner } from '../progress/createSpinner.js';
import type {
  PasswordObject,
  HashWithLeaksAndPasswordObjects,
  OnProgress,
} from '../types.js';
import { HASH_PREFIX_LENGTH, MAX_SPLIT_FILE_CONCURRENCY, HIBP_API_HASH_LENGTH } from '../constants.js';
import { measureSequentialSpeedFromDir } from '../memory/detectHDD.js';
import { parseBuffer, type ParseBufferResult } from '../hashing/parseBuffer.js';
import { promisePool } from './promisePool.js';
import { formatNumber } from '../formatting/formatNumber.js';
import { formatCompact } from '../formatting/formatCompact.js';
import { formatDuration } from '../formatting/formatDuration.js';
import { groupHashesByPrefix } from '../hashing/groupByPrefix.js';
import { getAvailableMemBytes } from '../memory/getAvailableMemBytes.js';
import { parseEnvInt } from '../memory/parseEnvInt.js';
import { createSpeedTracker } from './speedTracker.js';
import { enrichWithPasswordObjects } from '../enrichResults.js';

/**
 * Process a split-prefix HIBP directory.
 *
 * Each file in the directory is named `<5-char-prefix>.txt` and contains
 * hashes with that prefix. This function:
 * 1. Groups hashes by prefix.
 * 2. Detects disk type (HDD vs SSD) for concurrency tuning.
 * 3. Reads and parses each prefix file in parallel (SSD) or serially (HDD).
 * 4. Tolerates missing prefix files (dataset may be incomplete).
 *
 * @param hashesWithPasswordObjects - Map from SHA-1 hex hash to password objects.
 * @param dirPath - Path to the split-prefix directory.
 * @param encoding - Buffer encoding for hash comparison.
 * @param logger - Optional logging callback.
 * @param onProgress - Optional progress callback.
 * @returns Enriched results with leak counts and password objects.
 *
 * @security Handles SHA-1 hash maps derived from passwords — treat as sensitive.
 */
export async function processSplitDirectory(
  hashesWithPasswordObjects: Map<string, Array<PasswordObject>>,
  dirPath: string,
  encoding: BufferEncoding,
  logger?: (message: string) => void,
  onProgress?: OnProgress,
): Promise<Array<HashWithLeaksAndPasswordObjects>> {
  let prefixSpinner: Ora | undefined;
  if (logger) {
    prefixSpinner = createSpinner('Generating prefix groups and fingerprints...').start();
  }
  const prefixToSuffix = groupHashesByPrefix(hashesWithPasswordObjects, HASH_PREFIX_LENGTH);
  prefixSpinner?.succeed('Generating prefix groups and fingerprints');

  const matchingPrefixes = Array.from(prefixToSuffix.keys());
  const totalPrefixes = matchingPrefixes.length;
  const results: Array<{ hash: string; leaks: number }> = [];
  if (totalPrefixes === 0) return [];

  let canDetect = true;

  try {
    await fs.promises.access(dirPath);
  } catch {
    canDetect = false;
  }

  let isHDD = false;

  let diskSpinner: Ora | undefined;
  if (canDetect) {
    diskSpinner = createSpinner('Checking disk type...').start();
    const diskResult = await measureSequentialSpeedFromDir(dirPath, logger);
    isHDD = diskResult.isHDD;
  }

  const memoryCap = Math.max(1, Math.floor(getAvailableMemBytes() / (2 * 1024 * 1024)));
  const envConcurrency = parseEnvInt('SPLIT_FILE_CONCURRENCY', 1, MAX_SPLIT_FILE_CONCURRENCY, NaN, logger);
  let maxConcurrency: number;
  if (Number.isFinite(envConcurrency)) {
    maxConcurrency = Math.min(totalPrefixes, envConcurrency);
  } else if (isHDD) {
    maxConcurrency = 1;
  } else {
    maxConcurrency = Math.min(totalPrefixes, os.availableParallelism() * 2, memoryCap);
  }

  matchingPrefixes.sort();
  if (diskSpinner) {
    if (isHDD) {
      diskSpinner.succeed('HDD detected, using 1 worker (sorted by prefix)');
    } else {
      diskSpinner.succeed(`SSD/NVMe detected (concurrency: ${maxConcurrency})`);
    }
  }

  let processedPrefixCount = 0;
  let totalMatchedHashCount = 0;
  let totalCumulativeLeakCount = 0;
  let totalRejectedLineCount = 0;
  let missingFileCount = 0;
  const speedTracker = createSpeedTracker();
  const startInstant = Temporal.Now.instant();

  onProgress?.({
    current: 0, total: totalPrefixes, phase: 'Scan dir', format: 'compact', workers: maxConcurrency,
  });

  try {
    const taskResults = await promisePool(matchingPrefixes, maxConcurrency, async (prefix) => {
      const prefixFilePath = path.join(dirPath, `${prefix}.txt`);
      const entry = prefixToSuffix.get(prefix);
      if (!entry) {
        throw new Error(`Invariant: prefix "${prefix}" not found in prefixToSuffixMap`);
      }
      const { map: suffixLookupMap, set: suffixFpSet } = entry;

      let fileResults: Array<{ hash: string; leaks: number }>;
      let stats: ParseBufferResult;
      try {
        const fileContent = await fs.promises.readFile(prefixFilePath);
        const parsed = parseBuffer(
          fileContent,
          HIBP_API_HASH_LENGTH,
          suffixLookupMap,
          suffixFpSet,
          encoding,
        );
        stats = parsed.stats;
        fileResults = parsed.results;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        missingFileCount += 1;
        stats = {
          matchedHashCount: 0, cumulativeLeakCount: 0, rejectedLineCount: 0, linesProcessed: 0,
        };
        fileResults = [];
      }

      processedPrefixCount += 1;
      const speed = speedTracker.record(processedPrefixCount);
      onProgress?.({
        current: processedPrefixCount, total: totalPrefixes, speed, phase: 'Scan dir', format: 'compact', workers: maxConcurrency,
      });
      return { stats, fileResults };
    });

    taskResults.forEach(({ stats, fileResults }) => {
      totalMatchedHashCount += stats.matchedHashCount;
      totalCumulativeLeakCount += stats.cumulativeLeakCount;
      totalRejectedLineCount += stats.rejectedLineCount;
      results.push(...fileResults);
    });
  } finally {
    // no cleanup needed
  }

  onProgress?.({
    current: totalPrefixes, total: totalPrefixes, phase: 'Scan dir', format: 'compact', workers: maxConcurrency,
  });

  if (logger) {
    if (totalRejectedLineCount > 0) {
      logger(`Warning: ${totalRejectedLineCount} line(s) with invalid format were skipped`);
    }
    if (missingFileCount > 0) {
      logger(`Warning: ${missingFileCount} prefix file(s) were missing - the HIBP dataset may be incomplete`);
    }
    const totalElapsed = (Date.now() - startInstant.epochMilliseconds) / 1000;
    const avgFilesPerSecond = totalElapsed === 0
      ? 0
      : Math.round(totalPrefixes / totalElapsed);
    logger(
      `Checked all ${formatNumber(totalPrefixes)} prefix files.`
      + ` Found ${formatNumber(totalMatchedHashCount)} hashes`
      + ` with total ${formatNumber(totalCumulativeLeakCount)} (${formatCompact(totalCumulativeLeakCount)}) leaks`,
    );
    logger(`Reading ${formatNumber(avgFilesPerSecond)} files per second`);
    logger(`Checked passwords in ${formatDuration(startInstant, Temporal.Now.instant())}`);
  }

  let enrichSpinner: Ora | undefined;
  if (logger) {
    enrichSpinner = createSpinner('Enriching matched hashes with password objects...').start();
  }
  const enriched = enrichWithPasswordObjects(results, hashesWithPasswordObjects);
  enrichSpinner?.succeed('Enriching matched hashes with password objects');
  return enriched;
}
