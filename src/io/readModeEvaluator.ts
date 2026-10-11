import os from 'os';

import { getAvailableMemBytes } from '../memory/getAvailableMemBytes.js';
import {
  IDX_PREFIX_COUNT,
  AVG_HIBP_LINE_LENGTH,
  SSD_SEQ_MULTIPLIER,
  SSD_INDEX_SEEK_MS,
  SSD_BINARY_BASE_SEEK_MS,
  HDD_BINARY_MULTIPLIER,
  BINARY_JS_OVERHEAD_MS,
  BINARY_SEARCH_READ_SIZE,
} from '../constants.js';

/**
 * Calculate effective I/O concurrency bounded by threadpool, CPU, and memory.
 *
 * @param count - Desired concurrency.
 * @returns Concurrency limited by UV_THREADPOOL_SIZE, CPU count, and available memory.
 */
export function effectiveIOConcurrency(count: number): number {
  const env = process.env.UV_THREADPOOL_SIZE;
  const threadpoolSize = env !== undefined
    ? (() => {
      const n = parseInt(env, 10);
      return Number.isFinite(n) && n > 0 ? n : os.availableParallelism();
    })()
    : os.availableParallelism();
  return Math.min(
    count,
    threadpoolSize,
    Math.max(1, Math.floor(getAvailableMemBytes() / (2 * 1024 * 1024))),
  );
}

/**
 * Estimate sequential read time for a file.
 *
 * @param fileSize - Size of the file in bytes.
 * @param iopMBps - Measured sequential I/O speed in MB/s.
 * @param isHDD - Whether the drive is an HDD (no SSD multiplier).
 * @returns Estimated time in milliseconds.
 */
export function sequentialReadTimeMs(
  fileSize: number,
  iopMBps: number,
  isHDD: boolean = false,
): number {
  const effectiveMBps = isHDD ? iopMBps : iopMBps * SSD_SEQ_MULTIPLIER;
  return (fileSize * 1000) / (effectiveMBps * 1024 * 1024);
}

/**
 * Estimate index-based read time.
 *
 * Accounts for per-prefix seek time and block read time, with I/O
 * parallelism on SSDs.
 *
 * @param distinctPrefixes - Number of distinct prefixes to look up.
 * @param fileSize - Size of the HIBP file.
 * @param iopMBps - Measured sequential I/O speed in MB/s.
 * @param seekTimeMs - Estimated seek time per read.
 * @param isHDD - Whether the drive is an HDD.
 * @returns Estimated time in milliseconds.
 */
export function indexReadTimeMs(
  distinctPrefixes: number,
  fileSize: number,
  iopMBps: number,
  seekTimeMs: number,
  isHDD: boolean,
): number {
  const avgBlockSize = fileSize / IDX_PREFIX_COUNT;
  const blockReadTimeMs = (avgBlockSize * 1000) / (iopMBps * 1024 * 1024);
  if (isHDD) return distinctPrefixes * (seekTimeMs + blockReadTimeMs);
  const ioParallelism = effectiveIOConcurrency(distinctPrefixes);
  const batches = Math.ceil(distinctPrefixes / ioParallelism);
  return distinctPrefixes * SSD_INDEX_SEEK_MS + batches * blockReadTimeMs;
}

/**
 * Check whether index-based reading is slower than sequential.
 *
 * @param distinctPrefixes - Number of distinct prefixes.
 * @param fileSize - Size of the HIBP file.
 * @param iopMBps - Measured sequential I/O speed in MB/s.
 * @param seekTimeMs - Estimated seek time per read.
 * @param isHDD - Whether the drive is an HDD.
 * @returns True if index reading would be slower.
 */
export function indexSlowerThanSeq(
  distinctPrefixes: number,
  fileSize: number,
  iopMBps: number,
  seekTimeMs: number,
  isHDD: boolean,
): boolean {
  if (iopMBps <= 0 || seekTimeMs <= 0) return true;
  return indexReadTimeMs(distinctPrefixes, fileSize, iopMBps, seekTimeMs, isHDD)
    > sequentialReadTimeMs(fileSize, iopMBps, isHDD);
}

/**
 * Estimate binary search time for a given hash count.
 *
 * Models the binary search as log2(N/lineLength) iterations, each requiring
 * a read probe. On SSDs, reads are parallelized; on HDDs, each seek is sequential.
 *
 * @param fileSize - Size of the HIBP file.
 * @param seekTimeMs - Estimated seek time per read.
 * @param hashCount - Number of hashes to search for.
 * @param isHDD - Whether the drive is an HDD.
 * @returns Estimated time in milliseconds.
 */
export function estimatedBinaryTimeMs(
  fileSize: number,
  seekTimeMs: number,
  hashCount: number,
  isHDD: boolean = false,
): number {
  if (seekTimeMs <= 0 || hashCount <= 0) return 0;
  const lines = fileSize / AVG_HIBP_LINE_LENGTH;
  const iterations = Math.ceil(Math.log2(lines));

  let totalDistinctReads = 0;
  let rangeSize = fileSize;
  for (let k = 0; k < iterations; k += 1) {
    const maxDistinct = Math.ceil((rangeSize / BINARY_SEARCH_READ_SIZE) * 1.5);
    totalDistinctReads += Math.min(hashCount, maxDistinct);
    rangeSize /= 2;
  }

  if (isHDD) {
    return totalDistinctReads * seekTimeMs * HDD_BINARY_MULTIPLIER;
  }
  const concurrency = effectiveIOConcurrency(hashCount);
  const ioTimeMs = (totalDistinctReads / concurrency) * SSD_BINARY_BASE_SEEK_MS;
  const jsOverheadMs = totalDistinctReads * BINARY_JS_OVERHEAD_MS;
  return ioTimeMs + jsOverheadMs;
}

/**
 * Find the maximum number of hashes for which binary search is faster than sequential.
 *
 * Uses binary search on the hash count to find the crossover point.
 *
 * @param fileSize - Size of the HIBP file.
 * @param iopMBps - Measured sequential I/O speed in MB/s.
 * @param seekTimeMs - Estimated seek time per read.
 * @param hashCount - Total number of hashes.
 * @param isHDD - Whether the drive is an HDD.
 * @returns Maximum hash count where binary search is faster.
 */
export function maxBinaryHashes(
  fileSize: number,
  iopMBps: number,
  seekTimeMs: number,
  hashCount: number,
  isHDD: boolean = false,
): number {
  if (iopMBps <= 0 || seekTimeMs <= 0) return 0;
  const seqTimeMs = sequentialReadTimeMs(fileSize, iopMBps, isHDD);
  let lo = 0;
  let hi = hashCount;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimatedBinaryTimeMs(fileSize, seekTimeMs, mid, isHDD) <= seqTimeMs) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/**
 * Result of read mode evaluation — which reader to use and timing estimates.
 *
 * @property reader - Recommended reader ('index', 'binary', or 'sequential').
 * @property seqTimeMs - Estimated sequential read time.
 * @property idxTimeMs - Estimated index read time (if index is available).
 * @property binTimeMs - Estimated binary search time.
 * @property binCap - Maximum hash count where binary search is faster than sequential.
 */
export interface ReadModeEvaluation {
  reader: 'index' | 'binary' | 'sequential';
  seqTimeMs: number;
  idxTimeMs?: number;
  binTimeMs?: number;
  binCap?: number;
}

/**
 * Evaluate and recommend the best read mode for a single HIBP file.
 *
 * Considers file size, disk speed, seek time, hash count, and index availability.
 * Returns timing estimates for all viable modes and recommends the fastest.
 *
 * @param params - File characteristics and disk performance metrics.
 * @param params.fileSize - Size of the file in bytes.
 * @param params.iopMBps - Measured I/O throughput in MB/s.
 * @param params.seekTimeMs - Estimated seek time in milliseconds.
 * @param params.isHDD - Whether the storage is an HDD.
 * @param params.hashCount - Total number of hashes in the file.
 * @param params.uniquePrefixCount - Number of unique 5-char prefixes.
 * @param params.preCheckSkipped - Whether the speed test was skipped.
 * @param params.hasFreshIdx - Whether a fresh index file exists.
 * @returns Evaluation with recommended reader and timing estimates.
 */
export function evaluateReadMode(params: {
  fileSize: number;
  iopMBps: number;
  seekTimeMs: number;
  isHDD: boolean;
  hashCount: number;
  uniquePrefixCount: number;
  preCheckSkipped: boolean;
  hasFreshIdx: boolean;
}): ReadModeEvaluation {
  let { iopMBps, seekTimeMs } = params;
  if (params.preCheckSkipped && (iopMBps <= 0 || seekTimeMs <= 0)) {
    iopMBps = 600;
    seekTimeMs = 0.05;
  }
  if (iopMBps <= 0 || seekTimeMs <= 0) {
    return { reader: 'sequential', seqTimeMs: Infinity };
  }

  const seqTimeMs = sequentialReadTimeMs(params.fileSize, iopMBps, params.isHDD);

  if (params.hasFreshIdx) {
    const idxTimeMs = indexReadTimeMs(
      params.uniquePrefixCount,
      params.fileSize,
      iopMBps,
      seekTimeMs,
      params.isHDD,
    );
    if (idxTimeMs <= seqTimeMs) {
      const binCap = maxBinaryHashes(
        params.fileSize,
        iopMBps,
        seekTimeMs,
        params.hashCount,
        params.isHDD,
      );
      const binTimeMs = estimatedBinaryTimeMs(
        params.fileSize,
        seekTimeMs,
        params.hashCount,
        params.isHDD,
      );
      return {
        reader: 'index', seqTimeMs, idxTimeMs, binTimeMs, binCap,
      };
    }
    const binCap = maxBinaryHashes(
      params.fileSize,
      iopMBps,
      seekTimeMs,
      params.hashCount,
      params.isHDD,
    );
    const binTimeMs = estimatedBinaryTimeMs(
      params.fileSize,
      seekTimeMs,
      params.hashCount,
      params.isHDD,
    );
    if (params.hashCount <= binCap) {
      return {
        reader: 'binary', seqTimeMs, idxTimeMs, binTimeMs, binCap,
      };
    }
    return {
      reader: 'sequential', seqTimeMs, idxTimeMs, binTimeMs, binCap,
    };
  }

  const binCap = maxBinaryHashes(
    params.fileSize,
    iopMBps,
    seekTimeMs,
    params.hashCount,
    params.isHDD,
  );
  const binTimeMs = estimatedBinaryTimeMs(
    params.fileSize,
    seekTimeMs,
    params.hashCount,
    params.isHDD,
  );
  if (params.hashCount <= binCap) {
    return {
      reader: 'binary', seqTimeMs, binTimeMs, binCap,
    };
  }
  return {
    reader: 'sequential', seqTimeMs, binTimeMs, binCap,
  };
}
