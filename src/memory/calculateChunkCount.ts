import {
  MBPS_PER_CHUNK,
  MAX_CHUNKS,
  MEMORY_HEADROOM,
} from '../constants.js';

/**
 * Calculate the optimal SSD chunk count from measured I/O and system parameters.
 *
 * Pure function — no I/O, no environment reads. Given the measured drive speed,
 * available memory, and system constraints, returns the optimal number of
 * concurrent chunks for file processing.
 *
 * @param params - Measured and system parameters.
 * @param params.iopMBps - Measured I/O throughput in MB/s.
 * @param params.availableMemBytes - Available system memory in bytes.
 * @param params.mapCloneBytes - Bytes needed for map cloning.
 * @param params.serializedSetBytes - Bytes needed for serialized fingerprint set.
 * @param params.cpuParallelism - Number of available CPU cores.
 * @param params.highWaterMark - Read buffer size in bytes per chunk.
 * @param params.readAhead - Number of read-ahead streams per chunk.
 * @returns Optimal number of concurrent chunks (≥ 1).
 */
export function calculateChunkCount(params: {
  iopMBps: number;
  availableMemBytes: number;
  mapCloneBytes: number;
  serializedSetBytes: number;
  cpuParallelism: number;
  highWaterMark: number;
  readAhead: number;
}): number {
  const perChunkBytes = params.highWaterMark * (params.readAhead + 1)
    + params.mapCloneBytes + params.serializedSetBytes;
  const memoryCap = Math.max(1, Math.floor(
    params.availableMemBytes / (perChunkBytes * MEMORY_HEADROOM),
  ));
  const chunksFromSpeed = Math.max(1, Math.floor(params.iopMBps / MBPS_PER_CHUNK) + 1);
  return Math.min(
    MAX_CHUNKS,
    params.cpuParallelism,
    memoryCap,
    chunksFromSpeed,
  );
}
