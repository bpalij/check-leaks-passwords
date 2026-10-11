import fs from 'fs';
import os from 'os';

import { getAvailableMemBytes } from './getAvailableMemBytes.js';
import {
  DRIVE_SPEED_TEST_SIZE,
  SMALL_FILE_BYTES_THRESHOLD,
  DEFAULT_READ_AHEAD,
  MAX_READ_AHEAD,
  HIGH_WATER_MARK,
  SSD_SEQUENTIAL_THRESHOLD_MB,
} from '../constants.js';
import { parseEnvInt } from './parseEnvInt.js';
import { calculateChunkCount } from './calculateChunkCount.js';

/** Estimated seek time for HDDs in milliseconds. */
const HDD_SEEK_TIME_MS = 10;
/** Estimated seek time for SSDs in milliseconds. */
const SSD_SEEK_TIME_MS = 0.05;

/**
 * Result of the optimal chunk count determination.
 */
export interface ChunkCountResult {
  /** Number of concurrent chunks to use for processing. */
  chunkCount: number;
  /** Whether the storage was detected as an HDD. */
  isHDD: boolean;
  /** Measured I/O throughput in MB/s. */
  iopMBps: number;
  /** Whether the speed test was skipped (small file). */
  preCheckSkipped: boolean;
  /** Total duration of the speed test in milliseconds. */
  testDurationMs: number;
  /** Estimated seek time per I/O in milliseconds. */
  seekTimeMs: number;
}

/**
 * Determine the optimal number of concurrent chunks for file processing.
 *
 * Performs a drive speed test (unless the file is small), detects HDD vs SSD,
 * and calculates the chunk count based on available memory, CPU parallelism,
 * and measured I/O throughput.
 *
 * @param filePath - Path to the file to process.
 * @param fileSize - Size of the file in bytes.
 * @param mapCloneBytes - Optional bytes needed for map cloning.
 * @param serializedSetBytes - Optional bytes needed for serialized sets.
 * @returns Chunk count result with metadata.
 */
export async function determineOptimalChunkCount(
  filePath: string,
  fileSize: number,
  mapCloneBytes?: number,
  serializedSetBytes?: number,
): Promise<ChunkCountResult> {
  const threshold = process.env.SPEED_TEST_MIN_BYTES !== undefined
    ? Number(process.env.SPEED_TEST_MIN_BYTES)
    : SMALL_FILE_BYTES_THRESHOLD;
  if (fileSize < threshold) {
    return {
      chunkCount: 1,
      isHDD: false,
      iopMBps: 0,
      preCheckSkipped: true,
      testDurationMs: 0,
      seekTimeMs: 0,
    };
  }

  const fd = await fs.promises.open(filePath, 'r');

  const testSize = Math.min(DRIVE_SPEED_TEST_SIZE, fileSize);

  // Warmup read: pull ~1MB into page cache before timing
  const warmupSize = Math.min(1024 * 1024, testSize);
  const warmupBuf = Buffer.allocUnsafe(warmupSize);
  await fd.read(warmupBuf, 0, warmupSize, 0);

  const readAhead = parseEnvInt('READ_AHEAD', 1, MAX_READ_AHEAD, DEFAULT_READ_AHEAD);

  // Sequential speed test: 3 reads (end + 2 random), return avg
  const buf = Buffer.alloc(testSize);

  const measure = async (pos: number): Promise<number> => {
    const s = performance.now();
    await fd.read(buf, 0, testSize, pos);
    return Math.max(performance.now() - s, 0.001);
  };

  const elapsed1 = await measure(fileSize - testSize);
  const iopMBps1 = (testSize / elapsed1) * (1000 / (1024 * 1024));
  const randPos1 = Math.floor(Math.random() * (fileSize - testSize));
  const elapsed2 = await measure(randPos1);
  const iopMBps2 = (testSize / elapsed2) * (1000 / (1024 * 1024));
  const randPos2 = Math.floor(Math.random() * (fileSize - testSize));
  const elapsed3 = await measure(randPos2);
  const iopMBps3 = (testSize / elapsed3) * (1000 / (1024 * 1024));
  const iopMBps = (iopMBps1 + iopMBps2 + iopMBps3) / 3;

  await fd.close();

  const testDurationMs = elapsed1 + elapsed2 + elapsed3;

  // Derive HDD flag and estimated seek time from sequential speed
  const isHDD = iopMBps <= SSD_SEQUENTIAL_THRESHOLD_MB;
  const seekTimeMs = isHDD ? HDD_SEEK_TIME_MS : SSD_SEEK_TIME_MS;

  if (isHDD) {
    return {
      chunkCount: 1,
      isHDD: true,
      iopMBps,
      preCheckSkipped: false,
      testDurationMs,
      seekTimeMs,
    };
  }

  const highWaterMarkMB = parseEnvInt('HIGH_WATER_MARK', 1, 128, HIGH_WATER_MARK / (1024 * 1024));
  const highWaterMark = highWaterMarkMB * 1024 * 1024;

  const chunkCount = calculateChunkCount({
    iopMBps,
    availableMemBytes: getAvailableMemBytes(),
    mapCloneBytes: mapCloneBytes ?? 0,
    serializedSetBytes: serializedSetBytes ?? 0,
    cpuParallelism: os.availableParallelism(),
    highWaterMark,
    readAhead,
  });

  return {
    chunkCount, isHDD: false, iopMBps, preCheckSkipped: false, testDurationMs, seekTimeMs,
  };
}
