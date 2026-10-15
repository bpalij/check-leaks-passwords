import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import type { Ora } from 'ora';

import { createSpinner } from '../progress/createSpinner.js';
import type {
  PasswordObject,
  HashWithLeaksAndPasswordObjects,
  OnProgress,
} from '../types.js';
import { HASH_PREFIX_LENGTH, MAX_HIBP_CONCURRENCY, SHA1_HEX_LENGTH } from '../constants.js';
import { groupHashesByPrefix } from '../hashing/groupByPrefix.js';
import { parseBuffer } from '../hashing/parseBuffer.js';
import { promisePool } from './promisePool.js';
import { formatNumber } from '../formatting/formatNumber.js';
import { formatCompact } from '../formatting/formatCompact.js';
import { formatDuration } from '../formatting/formatDuration.js';
import { getAvailableMemBytes } from '../memory/getAvailableMemBytes.js';
import { parseEnvInt } from '../memory/parseEnvInt.js';
import { createSpeedTracker } from './speedTracker.js';
import { enrichWithPasswordObjects } from '../enrichResults.js';

const pkg = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf-8'),
);

/**
 * Log a summary of HIBP API processing results.
 *
 * @param totalPrefixes - Number of prefix requests made.
 * @param totalMatchedHashCount - Number of hashes that matched.
 * @param totalCumulativeLeakCount - Sum of all leak counts.
 * @param totalRejectedLineCount - Number of lines with invalid format.
 * @param cloudflareHits - Number of Cloudflare cache hits.
 * @param cloudflareMisses - Number of Cloudflare cache misses.
 * @param startInstant - Processing start time.
 * @param logger - Logging callback.
 */
export function logHibpApiSummary(
  totalPrefixes: number,
  totalMatchedHashCount: number,
  totalCumulativeLeakCount: number,
  totalRejectedLineCount: number,
  cloudflareHits: number,
  cloudflareMisses: number,
  startInstant: Temporal.Instant,
  logger: (message: string) => void,
): void {
  if (totalRejectedLineCount > 0) {
    logger(`Warning: ${totalRejectedLineCount} line(s) with invalid format were skipped`);
  }
  const totalElapsed = (Date.now() - startInstant.epochMilliseconds) / 1000;
  const avgPerSecond = totalElapsed === 0
    ? 0
    : Math.round(totalPrefixes / totalElapsed);
  const cloudflareTotal = cloudflareHits + cloudflareMisses;
  const hitPct = cloudflareTotal === 0 ? '0.0' : ((cloudflareHits / cloudflareTotal) * 100).toFixed(1);
  const missPct = cloudflareTotal === 0 ? '0.0' : ((cloudflareMisses / cloudflareTotal) * 100).toFixed(1);
  logger(
    `Checked all ${formatNumber(totalPrefixes)} prefix requests.`
    + ` Found ${formatNumber(totalMatchedHashCount)} hashes`
    + ` with total ${formatNumber(totalCumulativeLeakCount)} (${formatCompact(totalCumulativeLeakCount)}) leaks`,
  );
  logger(`Processing ${formatNumber(avgPerSecond)} avg requests per second`);
  logger(`Cloudflare cache: ${cloudflareTotal} total, hit: ${cloudflareHits} (${hitPct}%), miss: ${cloudflareMisses} (${missPct}%)`);
  logger(`Checked passwords in ${formatDuration(startInstant, Temporal.Now.instant())}`);
}

/**
 * Check passwords against the HIBP Passwords API using k-anonymity.
 *
 * Uses the range API: sends only the 5-character prefix of each SHA-1 hash,
 * receives all hashes with that prefix, and matches locally. This means
 * the actual password hashes are never sent to the server.
 *
 * Features:
 * - Concurrent requests with configurable parallelism.
 * - Automatic retry with exponential backoff (10 attempts).
 * - Circuit breaker: aborts after 3 consecutive failures.
 * - Cloudflare cache hit/miss tracking.
 *
 * @param hashesWithPasswordObjects - Map from SHA-1 hex hash to password objects.
 * @param apiUrl - HIBP API base URL (must end with `/`).
 * @param logger - Optional logging callback.
 * @param onProgress - Optional progress callback.
 * @param onRetry - Optional callback for retry notifications.
 * @param fullHashLength - Length of a full hex hash (40 for SHA-1, 32 for NTLM).
 *   Only the 5-character prefix is transmitted; the API suffix length is derived
 *   as `fullHashLength - HASH_PREFIX_LENGTH` (35 for SHA-1, 27 for NTLM).
 *   Defaults to 40 (SHA-1).
 * @returns Enriched results with leak counts and password objects.
 *
 * @security Handles password hash maps derived from passwords — treat as sensitive.
 * Only the 5-character prefix is ever sent externally.
 */
export async function processHibpApi(
  hashesWithPasswordObjects: Map<string, Array<PasswordObject>>,
  apiUrl: string,
  logger?: (message: string) => void,
  onProgress?: OnProgress,
  onRetry?: (message: string) => void,
  fullHashLength: number = SHA1_HEX_LENGTH,
): Promise<Array<HashWithLeaksAndPasswordObjects>> {
  const apiSuffixLength = fullHashLength - HASH_PREFIX_LENGTH;
  let prefixSpinner: Ora | undefined;
  if (logger) {
    prefixSpinner = createSpinner('Generating prefix groups and fingerprints...').start();
  }
  const prefixToSuffix = groupHashesByPrefix(
    hashesWithPasswordObjects,
    HASH_PREFIX_LENGTH,
    fullHashLength,
  );
  prefixSpinner?.succeed('Generating prefix groups and fingerprints');
  const matchingPrefixes = Array.from(prefixToSuffix.keys());
  const totalPrefixes = matchingPrefixes.length;
  const results: Array<{ hash: string; leaks: number }> = [];
  if (totalPrefixes === 0) return [];

  const startInstant = Temporal.Now.instant();

  let processedCount = 0;
  let totalMatchedHashCount = 0;
  let totalCumulativeLeakCount = 0;
  let totalRejectedLineCount = 0;
  let cloudflareHits = 0;
  let cloudflareMisses = 0;
  const speedTracker = createSpeedTracker();

  const availableMemBytes = getAvailableMemBytes();
  const memoryCap = Math.max(1, Math.floor(availableMemBytes / (2 * 1024 * 1024)));
  const parallelismCap = os.availableParallelism() * 16;
  const concurrency = parseEnvInt(
    'HIBP_CONCURRENCY',
    1,
    MAX_HIBP_CONCURRENCY,
    Math.min(200, parallelismCap, memoryCap),
    logger,
  );

  /**
   * Fetch a single prefix from the HIBP API with retry and timeout.
   *
   * Uses a 5-second abort timeout per attempt and exponential backoff
   * between retries (1s, 2s, 3s, ... 10s).
   *
   * @param prefix - The 5-character hex prefix to fetch.
   * @returns The API response.
   * @throws {Error} After 10 failed attempts.
   */
  const fetchWithRetry = async (prefix: string): Promise<Response> => {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await fetch(`${apiUrl}${prefix}`, {
          signal: controller.signal,
          headers: {
            'User-Agent': `check-leaks-passwords/${pkg.version}`,
            'Add-Padding': 'true',
          },
        });

        if (!response.ok) {
          // eslint-disable-next-line no-await-in-loop
          const body = await response.text().catch(() => '<unreadable>');
          throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
        }
        clearTimeout(timeoutId);
        return response;
      } catch (err) {
        clearTimeout(timeoutId);
        if (attempt >= 10) {
          throw err instanceof Error
            ? err
            : new Error(`Failed to fetch prefix ${prefix} after 10 attempts`);
        }
        if (onRetry) {
          const message = err instanceof Error ? err.message : String(err);
          onRetry(
            `Failed attempt #${attempt} while fetching prefix ${prefix}. ${message}`,
          );
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => { setTimeout(r, 1000 * attempt); });
      }
    }
    throw new Error('Unexpected end of retry loop');
  };

  type FetchAndParseResult = {
    matchedHashCount: number;
    cumulativeLeakCount: number;
    rejectedLineCount: number;
    fileResults: Array<{ hash: string; leaks: number }>;
  };

  /**
   * Fetch a prefix from the API and parse the response.
   *
   * Tracks Cloudflare cache status from the `cf-cache-status` header.
   * Parses the response buffer using `parseBuffer()` for hash matching.
   *
   * @param prefix - The 5-character hex prefix.
   * @returns Parsed results and statistics.
   */
  const fetchAndParse = async (prefix: string): Promise<FetchAndParseResult> => {
    const entry = prefixToSuffix.get(prefix);
    if (!entry) {
      throw new Error(`Invariant: prefix "${prefix}" not found in prefixToSuffixMap`);
    }
    const { map: suffixLookupMap, set: suffixFpSet } = entry;

    const response = await fetchWithRetry(prefix);

    const cfStatus = response.headers.get('cf-cache-status');
    if (cfStatus === 'HIT') {
      cloudflareHits += 1;
    } else {
      cloudflareMisses += 1;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    const { stats, results: fileResults } = parseBuffer(
      buffer,
      apiSuffixLength,
      suffixLookupMap,
      suffixFpSet,
      'ascii',
      { fullHashLength },
    );

    return {
      matchedHashCount: stats.matchedHashCount,
      cumulativeLeakCount: stats.cumulativeLeakCount,
      rejectedLineCount: stats.rejectedLineCount,
      fileResults,
    };
  };

  onProgress?.({
    current: 0, total: totalPrefixes, speed: 0, format: 'compact', workers: concurrency,
  });

  let consecutiveFailures = 0;
  /** Number of consecutive prefix failures before aborting (circuit breaker). */
  const CIRCUIT_BREAKER_THRESHOLD = 3;

  try {
    const taskResults = await promisePool(matchingPrefixes, concurrency, async (prefix) => {
      if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        throw new Error(
          `HIBP API circuit breaker: ${consecutiveFailures} consecutive prefix failures. Aborting.`,
        );
      }
      let result: FetchAndParseResult;
      try {
        result = await fetchAndParse(prefix);
      } catch (err) {
        consecutiveFailures += 1;
        throw err;
      }
      consecutiveFailures = 0;
      processedCount += 1;
      const speed = speedTracker.record(processedCount);
      onProgress?.({
        current: processedCount, total: totalPrefixes, speed, format: 'compact', workers: concurrency,
      });
      return result;
    });

    taskResults.forEach(({
      matchedHashCount, cumulativeLeakCount, rejectedLineCount, fileResults,
    }) => {
      totalMatchedHashCount += matchedHashCount;
      totalCumulativeLeakCount += cumulativeLeakCount;
      totalRejectedLineCount += rejectedLineCount;
      results.push(...fileResults);
    });
  } finally {
    // no cleanup needed
  }

  onProgress?.({
    current: totalPrefixes, total: totalPrefixes, format: 'compact', workers: concurrency,
  });

  if (logger) {
    logHibpApiSummary(
      totalPrefixes,
      totalMatchedHashCount,
      totalCumulativeLeakCount,
      totalRejectedLineCount,
      cloudflareHits,
      cloudflareMisses,
      startInstant,
      logger,
    );
  }

  let enrichSpinner: Ora | undefined;
  if (logger) {
    enrichSpinner = createSpinner('Enriching matched hashes with password objects...').start();
  }
  const enriched = enrichWithPasswordObjects(results, hashesWithPasswordObjects);
  enrichSpinner?.succeed('Enriching matched hashes with password objects');
  return enriched;
}
