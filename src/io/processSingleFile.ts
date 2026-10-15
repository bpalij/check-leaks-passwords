import fs from 'fs';
import v8 from 'v8';

import type { Ora } from 'ora';

import { createSpinner } from '../progress/createSpinner.js';
import { formatDuration } from '../formatting/formatDuration.js';
import type {
  PasswordObject,
  HashWithLeaksAndPasswordObjects,
  OnProgress,
  SingleFileReadMode,
} from '../types.js';
import { formatBytes } from '../formatting/formatBytes.js';
import { buildHashLookupMap } from '../hashing/buildLookupMap.js';
import { determineOptimalChunkCount } from '../memory/determineOptimalChunkCount.js';
import { sequentialReader } from './readModes/sequential.js';
import { binarySearchReader } from './readModes/binarySearch.js';
import { indexReader } from './readModes/indexBased.js';
import { processChunk, type ChunkDescriptor, type ChunkResult } from './processChunk.js';
import { MAX_CHUNKS, SHA1_HEX_LENGTH } from '../constants.js';
import { parseEnvInt } from '../memory/parseEnvInt.js';
import { evaluateReadMode } from './readModeEvaluator.js';
import { hashTypeCodeFor } from './indexHeader.js';
import {
  validateForcedMode,
  resolveMode,
  detectSortednessAndCleanup,
  tryLoadIndex,
  loadIndex,
  formatReadModeLog,
  dispatchReader,
} from './modeResolver.js';

/** Maximum number of distinct 4-byte keys for fingerprint density check. */
const MAX_KEY1_VALUES = 65536;

/** Fingerprint set is skipped when density exceeds 25% (too many collisions). */
const FINGERPRINT_DENSITY_THRESHOLD = 0.25;

/**
 * Process a single HIBP file with automatic read mode selection.
 *
 * Orchestrates the full single-file scan pipeline:
 * 1. Build hash lookup map and fingerprint set.
 * 2. Detect disk type (HDD vs SSD) and optimal chunk count.
 * 3. Select and execute the best read mode (sequential/binary/index).
 * 4. Optionally build a `.idx` file for future scans.
 *
 * Read mode selection logic:
 * - `auto`: Evaluate all modes, pick the fastest.
 * - `sequential`: Always use sequential streaming.
 * - `binary`: Use binary search (requires sorted file).
 * - `index`: Use pre-built `.idx` file (requires sorted file + fresh index).
 *   If no fresh `.idx` exists, runs a sequential scan that builds the index
 *   as a side-effect (when `buildIndex` is set), so the next run can use
 *   index mode.
 *
 * @param hashesWithPasswordObjects - Map from SHA-1 hex hash to password objects.
 * @param filePath - Path to the HIBP hashes file.
 * @param encoding - Buffer encoding for hash comparison.
 * @param logger - Optional logging callback.
 * @param chunkCountOverride - Override chunk count (bypasses disk detection).
 * @param onProgress - Optional progress callback.
 * @param singleFileReadMode - Read mode preference.
 * @param buildIndex - Whether to build a `.idx` file during processing.
 * @param fullHashLength - Length of a full hex hash (40 for SHA-1, 32 for NTLM).
 *   Defaults to 40 (SHA-1).
 * @returns Enriched results with leak counts and password objects.
 * @throws {Error} If the read mode is invalid or incompatible with file state.
 *
 * @security Handles password hash maps derived from passwords — treat as sensitive.
 */
export async function processSingleFile(
  hashesWithPasswordObjects: Map<string, Array<PasswordObject>>,
  filePath: string,
  encoding: BufferEncoding,
  logger?: (message: string) => void,
  chunkCountOverride?: number,
  onProgress?: OnProgress,
  singleFileReadMode?: SingleFileReadMode,
  buildIndex?: boolean,
  fullHashLength: number = SHA1_HEX_LENGTH,
): Promise<Array<HashWithLeaksAndPasswordObjects>> {
  const stat = await fs.promises.stat(filePath);
  const fileSize = stat.size;

  if (fileSize === 0) return [];

  let fingerprintSpinner: Ora | undefined;
  if (logger) {
    fingerprintSpinner = createSpinner('Building fingerprint index...').start();
  }
  const { map: hashLookupMap, set: fingerprintSet } = buildHashLookupMap(
    hashesWithPasswordObjects,
    fullHashLength,
  );

  const serializedMap = v8.serialize(hashLookupMap);
  const mapCloneBytes = serializedMap.length;

  const fingerprintDense = fingerprintSet.size / MAX_KEY1_VALUES > FINGERPRINT_DENSITY_THRESHOLD;
  const serializedFingerprints: Buffer | null = fingerprintDense
    ? null
    : v8.serialize(fingerprintSet);
  const setCloneBytes = serializedFingerprints?.length ?? 0;

  if (fingerprintSpinner) {
    const parts: string[] = [];
    parts.push(`map: ${formatBytes(mapCloneBytes)}`);
    if (!fingerprintDense) parts.push(`set: ${formatBytes(setCloneBytes)}`);
    else parts.push('set: skipped (dense)');
    const info = ` (${parts.join(', ')})`;
    fingerprintSpinner.succeed(`Building fingerprint index${info}`);
  }

  let chunkCount: number;

  let diskSpinner: Ora | undefined;
  if (logger) {
    diskSpinner = createSpinner('Checking disk type...').start();
  }
  const diskResult = await determineOptimalChunkCount(
    filePath,
    fileSize,
    mapCloneBytes,
    setCloneBytes,
  );
  const {
    seekTimeMs, iopMBps, isHDD: isHDDDetected, preCheckSkipped,
  } = diskResult;

  if (chunkCountOverride !== undefined) {
    chunkCount = chunkCountOverride;
  } else if (process.env.CHUNK_COUNT !== undefined) {
    chunkCount = parseEnvInt('CHUNK_COUNT', 1, MAX_CHUNKS, 1, logger);
    logger?.(`Using CHUNK_COUNT=${chunkCount} (from environment)`);
  } else {
    chunkCount = diskResult.chunkCount;
  }

  if (diskSpinner) {
    diskSpinner.stop();
    if (process.env.CHUNK_COUNT !== undefined) {
      // Already logged "Using CHUNK_COUNT=N" above — skip redundant drive speed line
    } else if (preCheckSkipped) {
      logger!('File <1 GB, using single chunk');
    } else if (isHDDDetected) {
      logger!('HDD detected, using 1 chunk');
    } else {
      logger!(`Drive speed: ~${Math.round(iopMBps)} MB/s (${diskResult.testDurationMs.toFixed(2)}ms test), using ${chunkCount} chunks`);
    }
  }

  const runSequential = (buildIdx?: boolean, sorted?: boolean) => sequentialReader(
    filePath,
    fileSize,
    chunkCount,
    hashLookupMap,
    serializedMap,
    serializedFingerprints,
    encoding,
    hashesWithPasswordObjects,
    logger,
    onProgress,
    buildIdx,
    sorted,
    isHDDDetected ? 2 : undefined,
    fullHashLength,
  );

  const envMode = validateForcedMode(process.env.READ_MODE_FORCED);
  const { mode, buildIdx } = resolveMode(envMode, singleFileReadMode, buildIndex ?? false);

  // Sortedness is resolved before any index-build decision: a .idx is only
  // usable for sorted files, so building one on unsorted input is pure waste
  // (it would be deleted by the next run's cleanup).
  const sorted = await detectSortednessAndCleanup(filePath, logger, fullHashLength);

  if (chunkCountOverride !== undefined) {
    return runSequential(buildIdx && sorted, sorted);
  }

  if (preCheckSkipped && !envMode) {
    return runSequential(buildIdx && sorted, sorted);
  }

  const fmt = (ms: number) => {
    const safeMs = Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0;
    return formatDuration(
      Temporal.Now.instant().subtract({ milliseconds: safeMs }),
      Temporal.Now.instant(),
    );
  };

  if (envMode) {
    logger?.(`Read mode overridden by READ_MODE_FORCED env: ${envMode}`);
    if ((envMode === 'binary' || envMode === 'index' || envMode === 'sequential-index') && !sorted) {
      throw new Error(`READ_MODE_FORCED=${envMode} requires a sorted file`);
    }
    if (envMode === 'binary') {
      const ev = evaluateReadMode({
        fileSize,
        iopMBps,
        seekTimeMs,
        isHDD: isHDDDetected,
        hashCount: hashesWithPasswordObjects.size,
        uniquePrefixCount: hashesWithPasswordObjects.size,
        preCheckSkipped,
        hasFreshIdx: false,
      });
      logger?.(`Read modes: binary ${fmt(ev.binTimeMs!)} ✓ | sequential ${fmt(ev.seqTimeMs)}`);
      return binarySearchReader(
        filePath,
        fileSize,
        hashLookupMap,
        fingerprintSet,
        encoding,
        hashesWithPasswordObjects,
        logger,
        onProgress,
        fullHashLength,
      );
    }
    if (envMode === 'index') {
      const idxPath = `${filePath}.idx`;
      let idxStat: fs.Stats;
      try { idxStat = await fs.promises.stat(idxPath); } catch { throw new Error('READ_MODE_FORCED=index requires a .idx file. Run with auto-index first.'); }
      if (idxStat.mtimeMs <= stat.mtimeMs) {
        throw new Error('READ_MODE_FORCED=index requires a fresh .idx file. Rebuild with auto-index.');
      }
      const idx = await loadIndex(idxPath, {
        hashType: hashTypeCodeFor(fullHashLength),
        fileSize,
      });
      const uniquePrefixes = new Set<number>();
      hashesWithPasswordObjects.forEach((_v, hash) => {
        uniquePrefixes.add(parseInt(hash.slice(0, 5), 16));
      });
      const ev = evaluateReadMode({
        fileSize,
        iopMBps,
        seekTimeMs,
        isHDD: isHDDDetected,
        hashCount: hashesWithPasswordObjects.size,
        uniquePrefixCount: uniquePrefixes.size,
        preCheckSkipped,
        hasFreshIdx: true,
      });
      logger?.(`Read modes: index ${fmt(ev.idxTimeMs!)} ✓ | sequential ${fmt(ev.seqTimeMs)}`);
      return indexReader(
        filePath,
        fileSize,
        hashLookupMap,
        fingerprintSet,
        encoding,
        idx,
        hashesWithPasswordObjects,
        logger,
        onProgress,
        isHDDDetected,
        fullHashLength,
      );
    }
    if (envMode === 'sequential-noindex') {
      const ev = evaluateReadMode({
        fileSize,
        iopMBps,
        seekTimeMs,
        isHDD: isHDDDetected,
        hashCount: hashesWithPasswordObjects.size,
        uniquePrefixCount: hashesWithPasswordObjects.size,
        preCheckSkipped,
        hasFreshIdx: false,
      });
      logger?.(`Read modes: sequential ${fmt(ev.seqTimeMs)}`);
      return runSequential(false);
    }
    const ev = evaluateReadMode({
      fileSize,
      iopMBps,
      seekTimeMs,
      isHDD: isHDDDetected,
      hashCount: hashesWithPasswordObjects.size,
      uniquePrefixCount: hashesWithPasswordObjects.size,
      preCheckSkipped,
      hasFreshIdx: true,
    });
    logger?.(`Read modes: sequential ${fmt(ev.seqTimeMs)}`);
    return runSequential(true, true);
  }

  let effectiveMode: SingleFileReadMode = mode;
  if (mode === 'index' && !buildIdx) {
    effectiveMode = 'auto';
    logger?.("Warning: 'index' mode with buildIndex=false — falling back to auto-detection without index building");
  }

  if (effectiveMode === 'sequential') {
    logger?.('Read mode: sequential');
    return runSequential(buildIdx && sorted, sorted);
  }

  if (effectiveMode === 'binary' && !sorted) return runSequential(buildIdx && sorted, sorted);

  if (effectiveMode !== 'auto' && effectiveMode !== 'binary' && effectiveMode !== 'index') {
    throw new Error(`Unknown singleFileReadMode: '${mode}'`);
  }

  if (!sorted) return runSequential(buildIdx && sorted, sorted);

  const hashCount = hashesWithPasswordObjects.size;
  let idx: BigUint64Array | undefined;
  let uniquePrefixCount = hashCount;
  let hasFreshIdx = false;

  if (effectiveMode === 'index' || effectiveMode === 'auto') {
    const indexData = await tryLoadIndex(
      filePath,
      stat.mtimeMs,
      hashesWithPasswordObjects,
      logger,
      { fullHashLength, fileSize },
    );
    if (indexData) {
      idx = indexData.idx;
      uniquePrefixCount = indexData.uniquePrefixCount;
      hasFreshIdx = true;
    }
  }

  // 'index' mode requires a fresh .idx (checked above via tryLoadIndex).
  // Without one, fall back to a sequential scan that piggybacks the index
  // build (buildIdx is always true here — 'index' with buildIndex=false was
  // converted to 'auto' above; sorted is always true — unsorted input
  // returned earlier). Without the build, index mode could never bootstrap
  // its own index and would stay sequential forever.
  if (effectiveMode === 'index' && !hasFreshIdx) {
    logger?.('No fresh .idx found — running sequential scan to build the index (next run will use index mode)');
    return runSequential(buildIdx && sorted, sorted);
  }

  const ev = evaluateReadMode({
    fileSize,
    iopMBps,
    seekTimeMs,
    isHDD: isHDDDetected,
    hashCount,
    uniquePrefixCount,
    preCheckSkipped,
    hasFreshIdx,
  });

  if (ev.idxTimeMs !== undefined || ev.binTimeMs !== undefined) {
    logger?.(formatReadModeLog(ev, fmt));
  }

  return dispatchReader(ev, {
    filePath,
    fileSize,
    hashLookupMap,
    fingerprintSet,
    encoding,
    idx,
    hashesWithPasswordObjects,
    logger,
    onProgress,
    isHDD: isHDDDetected,
    buildIdx,
    sorted,
    fullHashLength,
    runSequential,
  });
}

export { processChunk };
export type { ChunkDescriptor, ChunkResult };
