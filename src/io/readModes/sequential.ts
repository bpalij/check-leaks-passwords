import fs from 'fs';
import path from 'path';
import v8 from 'v8';
import { fileURLToPath } from 'url';
import { Worker } from 'worker_threads';

import type { Ora } from 'ora';

import { createSpinner } from '../../progress/createSpinner.js';
import type {
  PasswordObject,
  HashWithLeaksAndPasswordObjects,
  HashLookupEntry,
  OnProgress,
} from '../../types.js';
import { formatNumber } from '../../formatting/formatNumber.js';
import { formatBytes } from '../../formatting/formatBytes.js';
import { formatCompact } from '../../formatting/formatCompact.js';
import { formatDuration } from '../../formatting/formatDuration.js';
import {
  CHUNK_OVERLAP, IDX_HEADER_SIZE, IDX_PREFIX_COUNT, IDX_SORTED_FLAG_OK,
} from '../../constants.js';
import {
  processChunk,
  type ChunkDescriptor,
  type ChunkResult,
  type IndexRecorder,
} from '../processChunk.js';
import { type WorkerSettledRef, handleWorkerError, handleWorkerExit } from '../../worker/workerUtils.js';
import { createSpeedTracker } from '../speedTracker.js';
import { enrichWithPasswordObjects } from '../../enrichResults.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Sequential reader for single-file HIBP processing.
 *
 * Reads the file from start to end, splitting into chunks for parallel
 * processing via worker threads. Each chunk has overlapping read ranges
 * to handle lines that span chunk boundaries.
 *
 * Features:
 * - Worker-thread parallelism for multi-chunk processing.
 * - Read-ahead buffering via `processChunk()`.
 * - Optional `.idx` file building during the scan.
 * - Result deduplication across chunks.
 *
 * @param filePath - Path to the HIBP hashes file.
 * @param fileSize - Size of the file in bytes.
 * @param chunkCount - Number of parallel chunks.
 * @param hashLookupMap - Map from 4-byte key to candidate hash entries.
 * @param serializedMap - Serialized hash lookup map for workers.
 * @param serializedFingerprints - Serialized fingerprint set for workers.
 * @param encoding - Buffer encoding for hash comparison.
 * @param hashesWithPasswordObjects - Map from SHA-1 hex hash to password objects.
 * @param logger - Optional logging callback.
 * @param onProgress - Optional progress callback.
 * @param buildIndex - Whether to build a `.idx` file during processing.
 * @param sorted - Whether the file is sorted (needed for index building).
 * @param readAhead - Number of read-ahead streams per chunk.
 * @returns Enriched results with leak counts and password objects.
 *
 * @security Handles SHA-1 hash maps derived from passwords — treat as sensitive.
 */
export async function sequentialReader(
  filePath: string,
  fileSize: number,
  chunkCount: number,
  hashLookupMap: Map<number, HashLookupEntry[]>,
  serializedMap: Buffer,
  serializedFingerprints: Buffer | null,
  encoding: BufferEncoding,
  hashesWithPasswordObjects: Map<string, Array<PasswordObject>>,
  logger?: (message: string) => void,
  onProgress?: OnProgress,
  buildIndex?: boolean,
  sorted?: boolean,
  readAhead?: number,
): Promise<Array<HashWithLeaksAndPasswordObjects>> {
  const shouldBuildIndex = buildIndex === true;
  const chunkSize = Math.ceil(fileSize / chunkCount);

  const chunks: ChunkDescriptor[] = [];
  for (let i = 0; i < chunkCount; i += 1) {
    const coreStart = i * chunkSize;
    const coreEnd = i === chunkCount - 1
      ? fileSize
      : Math.min((i + 1) * chunkSize, fileSize);

    const readStart = i === 0
      ? 0
      : Math.max(coreStart - CHUNK_OVERLAP, 0);
    const readEnd = i === chunkCount - 1
      ? fileSize - 1
      : Math.min(coreEnd + CHUNK_OVERLAP - 1, fileSize - 1);

    chunks.push({
      readStart,
      readEnd,
      coreStart,
      coreEnd,
      isLast: i === chunkCount - 1,
    });
  }

  const progress = {
    bytes: 0,
    lines: 0,
    matched: 0,
    leaks: 0,
    startInstant: Temporal.Now.instant(),
  };
  const speedTracker = createSpeedTracker();
  let activeWorkers = chunkCount;

  onProgress?.({
    current: 0, total: fileSize, speed: 0, workers: activeWorkers, phase: 'Scan file', format: 'bytes',
  });

  const reportProgress = (
    deltaBytes: number,
    deltaLines: number,
    deltaMatched: number,
    deltaLeaks: number,
  ) => {
    progress.bytes += deltaBytes;
    progress.lines += deltaLines;
    progress.matched += deltaMatched;
    progress.leaks += deltaLeaks;
    if (deltaBytes === 0) return;
    const speed = speedTracker.record(progress.bytes);
    onProgress?.({
      current: progress.bytes, total: fileSize, speed, workers: activeWorkers, phase: 'Scan file', format: 'bytes',
    });
  };

  const prefixBoundaries: Array<{ prefix: number; offset: number }> = [];
  const indexRecorder: IndexRecorder | undefined = shouldBuildIndex
    ? {
      recordBoundary: (p: number, o: number) => {
        prefixBoundaries.push({ prefix: p, offset: o });
      },
    }
    : undefined;

  let chunkResults: ChunkResult[];

  if (chunkCount === 1) {
    await using fd = await fs.promises.open(filePath, 'r');
    const singleFingerprintSet: Set<number> | null = serializedFingerprints
      ? v8.deserialize(serializedFingerprints) as Set<number>
      : null;
    const result = await processChunk(
      chunks[0],
      fd,
      hashLookupMap,
      singleFingerprintSet,
      encoding,
      reportProgress,
      indexRecorder,
      readAhead,
    );
    chunkResults = [result];
  } else {
    const workerPath = path.resolve(currentDir, '../../../dist/worker/src/io/processChunkWorker.js');

    const workers: Worker[] = [];
    const chunkPromises = chunks.map((desc) => new Promise<ChunkResult>((resolve, reject) => {
      const worker = new Worker(workerPath, {
        workerData: {
          desc, filePath, serializedMap, serializedFingerprints, encoding, buildIndex,
        },
      });
      workers.push(worker);

      const settledRef: WorkerSettledRef = { current: false };

      worker.on('message', (msg) => {
        if (msg.type === 'progress') {
          reportProgress(msg.bytes, msg.lines, msg.matched, msg.leaks);
        } else if (msg.type === 'result') {
          settledRef.current = true;
          activeWorkers -= 1;
          worker.terminate();
          if (shouldBuildIndex && msg.prefixBoundaries) {
            for (let bi = 0; bi < msg.prefixBoundaries.length; bi += 1) {
              prefixBoundaries.push(msg.prefixBoundaries[bi]);
            }
          }
          resolve(msg.data);
        } else if (msg.type === 'error') {
          settledRef.current = true;
          activeWorkers -= 1;
          worker.terminate();
          reject(new Error(msg.message));
        }
      });

      worker.on('error', (err) => {
        handleWorkerError(settledRef, worker, reject, err as Error, () => { activeWorkers -= 1; });
      });

      worker.on('exit', (code) => {
        handleWorkerExit(settledRef, reject, code, () => { activeWorkers -= 1; });
      });
    }));

    try {
      chunkResults = await Promise.all(chunkPromises);
    } catch (err) {
      workers.forEach((w) => w.terminate());
      throw err;
    }
  }

  // Build .idx from piggybacked prefix boundaries
  if (shouldBuildIndex && prefixBoundaries.length > 0) {
    try {
      const stat = await fs.promises.stat(filePath);
      const mtimeSec = Math.floor(stat.mtimeMs / 1000);

      prefixBoundaries.sort((a, b) => a.offset - b.offset);
      const seen = new Set<number>();
      const merged = prefixBoundaries.filter((b) => {
        if (seen.has(b.prefix)) return false;
        seen.add(b.prefix);
        return true;
      });

      const idxArr = new BigUint64Array(IDX_PREFIX_COUNT + 1);
      const seenPrefix = new Uint8Array(IDX_PREFIX_COUNT + 1);
      for (let mi = 0; mi < merged.length; mi += 1) {
        const { prefix, offset } = merged[mi];
        idxArr[prefix] = BigInt(offset);
        seenPrefix[prefix] = 1;
      }
      idxArr[IDX_PREFIX_COUNT] = BigInt(fileSize);
      seenPrefix[IDX_PREFIX_COUNT] = 1;
      for (let i = IDX_PREFIX_COUNT - 1; i >= 0; i -= 1) {
        if (!seenPrefix[i]) idxArr[i] = idxArr[i + 1];
      }

      const idxPath = `${filePath}.idx`;
      const headerBuf = Buffer.alloc(IDX_HEADER_SIZE);
      headerBuf[0] = sorted ? IDX_SORTED_FLAG_OK : 0;
      headerBuf.writeBigInt64LE(BigInt(mtimeSec), 1);
      const idxBuf = Buffer.alloc((IDX_PREFIX_COUNT + 1) * 8);
      for (let i = 0; i <= IDX_PREFIX_COUNT; i += 1) {
        idxBuf.writeBigUInt64LE(idxArr[i], i * 8);
      }
      const fullBuf = Buffer.concat([headerBuf, idxBuf]);
      await fs.promises.writeFile(idxPath, fullBuf);
      logger?.(`Index file written: ${idxPath}`);
    } catch {
      logger?.('Warning: index build failed — continuing without index');
    }
  }

  const totalRejected = chunkResults.reduce((sum, r) => sum + r.rejectedLineCount, 0);

  if (logger && totalRejected > 0) {
    logger(`Warning: ${totalRejected} line(s) with invalid format were skipped`);
  }

  if (logger) {
    const elapsedSec = (Date.now() - progress.startInstant.epochMilliseconds) / 1000;
    const throughput = elapsedSec <= 0 ? 0 : Math.round(progress.bytes / elapsedSec);
    logger(`Checked all ${formatBytes(fileSize)}. Found ${formatNumber(progress.matched)} hashes with total ${formatNumber(progress.leaks)} (${formatCompact(progress.leaks)}) leaks`);
    logger(`Processing ${formatBytes(throughput)}/s avg throughput`);
    logger(`Checked passwords in ${formatDuration(progress.startInstant, Temporal.Now.instant())}`);
  }

  let dedupSpinner: Ora | undefined;
  if (logger) {
    dedupSpinner = createSpinner('Deduplicating results...').start();
  }
  const seen = new Map<string, number>();
  const deduped: Array<{ hash: string; leaks: number }> = [];
  chunkResults.forEach((r) => {
    r.results.forEach((result) => {
      if (!seen.has(result.hash)) {
        seen.set(result.hash, result.leaks);
        deduped.push(result);
      } else if (seen.get(result.hash) !== result.leaks) {
        logger?.(`Warning: hash "${result.hash}" has differing leak counts (${seen.get(result.hash)} vs ${result.leaks}), using first`);
      }
    });
  });
  dedupSpinner?.succeed('Deduplicating results');

  let enrichSpinner: Ora | undefined;
  if (logger) {
    enrichSpinner = createSpinner('Enriching matched hashes with password objects...').start();
  }
  const enriched = enrichWithPasswordObjects(deduped, hashesWithPasswordObjects);
  enrichSpinner?.succeed('Enriching matched hashes with password objects');

  return enriched;
}
