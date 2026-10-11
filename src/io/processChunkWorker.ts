import { parentPort, workerData } from 'worker_threads';
import v8 from 'v8';
import fs from 'fs';

import { processChunk, type IndexRecorder } from './processChunk.js';

/**
 * Worker thread entry point for parallel chunk processing.
 *
 * Deserializes the hash lookup map and fingerprint set from the main thread,
 * processes a single chunk via `processChunk()`, and posts results back.
 *
 * Progress updates are batched and flushed every 100ms to reduce
 * message overhead between threads.
 */
async function run() {
  const {
    desc, filePath, serializedMap, serializedFingerprints, encoding, buildIndex,
  } = workerData as {
    desc: import('./processChunk.js').ChunkDescriptor;
    filePath: string;
    serializedMap: Buffer;
    serializedFingerprints: Buffer | null;
    encoding: BufferEncoding;
    buildIndex?: boolean;
  };

  const prefixBoundaries: Array<{ prefix: number; offset: number }> = [];
  const indexRecorder: IndexRecorder | undefined = buildIndex
    ? {
      recordBoundary: (prefix: number, offset: number) => {
        prefixBoundaries.push({ prefix, offset });
      },
    }
    : undefined;

  const hashLookupMap = v8.deserialize(serializedMap) as Map<number, import('../types.js').HashLookupEntry[]>;
  const fingerprintSet: Set<number> | null = serializedFingerprints
    ? v8.deserialize(serializedFingerprints) as Set<number>
    : null;

  let accBytes = 0;
  let accLines = 0;
  let accMatched = 0;
  let accLeaks = 0;

  /** Flush accumulated progress to the main thread. */
  const flush = () => {
    if (accBytes !== 0 || accLines !== 0) {
      parentPort?.postMessage({
        type: 'progress',
        bytes: accBytes,
        lines: accLines,
        matched: accMatched,
        leaks: accLeaks,
      });
      accBytes = 0;
      accLines = 0;
      accMatched = 0;
      accLeaks = 0;
    }
  };

  const flushTimer = setInterval(flush, 100);

  try {
    await using fd = await fs.promises.open(filePath, 'r');
    const result = await processChunk(
      desc,
      fd,
      hashLookupMap,
      fingerprintSet,
      encoding,
      (bytes: number, lines: number, matched: number, leaks: number) => {
        accBytes += bytes;
        accLines += lines;
        accMatched += matched;
        accLeaks += leaks;
      },
      indexRecorder,
    );
    clearInterval(flushTimer);
    flush();
    parentPort?.postMessage({
      type: 'result',
      data: result,
      prefixBoundaries: buildIndex ? prefixBoundaries : undefined,
    });
  } catch (err) {
    clearInterval(flushTimer);
    flush();
    parentPort?.postMessage({ type: 'error', message: (err as Error).message });
  }
}

run();
