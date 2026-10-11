import fs from 'fs';
import path from 'path';

import { SSD_SEQUENTIAL_THRESHOLD_MB } from '../constants.js';

/** Number of files to sample for speed measurement. */
const SAMPLE_COUNT = 3;
/** Maximum consecutive missing prefix files before giving up. */
const MAX_CONSECUTIVE_MISSES = 10;

/**
 * Result of a sequential speed measurement.
 */
export interface SequentialSpeedResult {
  /** Measured sequential I/O throughput in MB/s. */
  iopMBps: number;
  /** Whether the storage was detected as an HDD. */
  isHDD: boolean;
}

/**
 * Measure sequential read speed from files in a directory.
 *
 * Randomly samples up to 3 files from a split-prefix HIBP directory
 * and measures their read throughput. Uses the minimum throughput
 * to detect HDDs (worst-case I/O).
 *
 * @param dirPath - Path to the directory containing split files.
 * @param logger - Optional logger for status messages.
 * @returns Sequential speed result with HDD detection flag.
 */
export async function measureSequentialSpeedFromDir(
  dirPath: string,
  logger?: (message: string) => void,
): Promise<SequentialSpeedResult> {
  try {
    await fs.promises.access(dirPath);
  } catch {
    return { iopMBps: 0, isHDD: false };
  }

  const fds: fs.promises.FileHandle[] = [];
  const fileSizes: number[] = [];
  let consecutiveMisses = 0;

  while (fds.length < SAMPLE_COUNT) {
    const prefix = Math.floor(Math.random() * 1048576)
      .toString(16).toUpperCase().padStart(5, '0');
    const filePath = path.join(dirPath, `${prefix}.txt`);

    try {
      // eslint-disable-next-line no-await-in-loop
      const fd = await fs.promises.open(filePath, 'r');
      // eslint-disable-next-line no-await-in-loop
      const stat = await fd.stat();
      fds.push(fd);
      fileSizes.push(stat.size);
      consecutiveMisses = 0;
    } catch {
      consecutiveMisses += 1;
      if (consecutiveMisses > MAX_CONSECUTIVE_MISSES) {
        logger?.('Disk type detection: too many missing prefixes, assuming non-HDD');
        return { iopMBps: 0, isHDD: false };
      }
    }
  }

  const throughputs: number[] = [];

  for (let i = 0; i < fds.length; i += 1) {
    const fileSize = fileSizes[i];
    if (fileSize === 0) {
      throughputs.push(Infinity);
    } else {
      const buf = Buffer.allocUnsafe(fileSize);
      const start = performance.now();
      // eslint-disable-next-line no-await-in-loop
      await fds[i].read(buf, 0, fileSize, 0);
      const elapsed = Math.max(performance.now() - start, 0.001);
      throughputs.push((fileSize / elapsed) * (1000 / (1024 * 1024)));
    }
  }

  await Promise.all(fds.map((fd) => fd.close()));

  const iopMBps = Math.min(...throughputs);
  const isHDD = iopMBps <= SSD_SEQUENTIAL_THRESHOLD_MB;

  return { iopMBps, isHDD };
}
