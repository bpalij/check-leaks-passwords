import { HashLookupEntry } from '../types.js';
import {
  DEFAULT_READ_AHEAD, HIGH_WATER_MARK, MAX_LINE_BYTES, MAX_READ_AHEAD, SHA1_HEX_LENGTH,
} from '../constants.js';
import { parseBuffer, type ParseBufferOptions } from '../hashing/parseBuffer.js';
import { parseEnvInt } from '../memory/parseEnvInt.js';

const NEWLINE = 0x0A;

/**
 * Describes a chunk's byte range in the HIBP file.
 *
 * Each chunk has overlapping read ranges to handle lines that span chunk
 * boundaries. The `core` range is the non-overlapping portion that this
 * chunk is responsible for.
 *
 * @property readStart - Start byte for reading (includes overlap from previous chunk).
 * @property readEnd - End byte for reading (inclusive, includes overlap from next chunk).
 * @property coreStart - Start of the non-overlapping core range.
 * @property coreEnd - End of the non-overlapping core range.
 * @property isLast - True if this is the final chunk (handles trailing partial line).
 */
export interface ChunkDescriptor {
  readStart: number;
  readEnd: number;
  coreStart: number;
  coreEnd: number;
  isLast: boolean;
}

/**
 * Result of processing a single chunk.
 *
 * @property results - Matched hashes with their leak counts.
 * @property bytesProcessed - Total bytes read from the file.
 * @property linesProcessed - Total lines scanned.
 * @property matchedHashCount - Number of lines that matched a hash.
 * @property cumulativeLeakCount - Sum of all leak counts for matched hashes.
 * @property rejectedLineCount - Lines with invalid format.
 */
export interface ChunkResult {
  results: Array<{ hash: string; leaks: number }>;
  bytesProcessed: number;
  linesProcessed: number;
  matchedHashCount: number;
  cumulativeLeakCount: number;
  rejectedLineCount: number;
}

/**
 * Callback for recording prefix boundary offsets during index building.
 *
 * Called by `parseBuffer()` when it encounters a new 5-character prefix,
 * allowing the sequential reader to build a `.idx` file.
 *
 * @property recordBoundary - Records a prefix and its file offset.
 */
export interface IndexRecorder {
  recordBoundary(prefix: number, offset: number): void;
}

/**
 * Process a single chunk of the HIBP file with read-ahead buffering.
 *
 * Implements a ring-buffer read-ahead scheme:
 * 1. Pre-fill `readAhead` slots with async reads.
 * 2. As each read completes, submit a new read to keep the pipeline full.
 * 3. Parse completed buffers and match against the hash lookup map.
 *
 * Handles partial lines across buffer boundaries using `partialLineBuffer`.
 * The last chunk flushes any remaining partial line.
 *
 * @param desc - Chunk byte range descriptor.
 * @param fd - Open file handle for reading.
 * @param hashLookupMap - Map from 4-byte key to candidate hash entries.
 * @param fingerprintSet - Optional fingerprint set for fast rejection.
 * @param encoding - Buffer encoding for hash comparison.
 * @param reportProgress - Callback to report progress deltas.
 * @param indexRecorder - Optional recorder for building `.idx` files.
 * @param readAhead - Number of read-ahead slots (default from READ_AHEAD env).
 * @returns Chunk processing results and statistics.
 * @throws {Error} If a line exceeds the maximum allowed length (corrupt input).
 */
export async function processChunk(
  desc: ChunkDescriptor,
  fd: import('fs/promises').FileHandle,
  hashLookupMap: Map<number, HashLookupEntry[]>,
  fingerprintSet: Set<number> | null,
  encoding: BufferEncoding,
  reportProgress: (
    deltaBytes: number,
    deltaLines: number,
    deltaMatched: number,
    deltaLeaks: number,
  ) => void,
  indexRecorder?: IndexRecorder,
  readAhead?: number,
): Promise<ChunkResult> {
  const effectiveReadAhead = readAhead
    ?? parseEnvInt('READ_AHEAD', 1, MAX_READ_AHEAD, DEFAULT_READ_AHEAD);
  const highWaterMarkMB = parseEnvInt('HIGH_WATER_MARK', 1, 128, HIGH_WATER_MARK / (1024 * 1024));
  const highWaterMark = highWaterMarkMB * 1024 * 1024;
  const buffers = Array.from(
    { length: effectiveReadAhead },
    () => Buffer.allocUnsafe(highWaterMark),
  );
  const readSlots: ({
    buf: Buffer; promise: Promise<{ bytesRead: number; buffer: Buffer }>; offset: number;
  } | null)[] = new Array(effectiveReadAhead).fill(null);
  let head = 0;
  let tail = 0;
  let filled = 0;
  let offset = desc.readStart;
  let partialLineBuffer: Buffer | null = null;
  let partialLineBufferOffset = 0;
  const results: Array<{ hash: string; leaks: number }> = [];
  let chunkBytes = 0;
  let chunkLines = 0;
  let chunkMatched = 0;
  let chunkLeaks = 0;
  let chunkRejected = 0;
  let pendingLines = 0;
  let pendingMatched = 0;
  let pendingLeaks = 0;
  const lastPrefixMutable = { value: -1 };

  const makePbOpts = (fileOffset: number): ParseBufferOptions | undefined => {
    if (!indexRecorder) return undefined;
    return {
      recordBoundary: (p: number, o: number) => indexRecorder.recordBoundary(p, o),
      bufferFileOffset: fileOffset,
      lastPrefix: lastPrefixMutable,
    };
  };

  /**
   * Submit an async read into the next available ring buffer slot.
   *
   * @returns True if a read was submitted, false if the chunk is fully read.
   */
  const submitRead = (): boolean => {
    const remainingLen = desc.readEnd - offset + 1;
    if (remainingLen <= 0) return false;
    const bytesToRead = Math.min(highWaterMark, remainingLen);
    const readOffset = offset;
    const buf = buffers[head];
    const promise = fd.read(buf, 0, bytesToRead, readOffset);
    offset += bytesToRead;
    readSlots[head] = { buf, promise, offset: readOffset };
    head = (head + 1) % effectiveReadAhead;
    filled += 1;
    return true;
  };

  /**
   * Process a completed read buffer, parsing lines and matching hashes.
   *
   * Handles partial lines from previous buffers by concatenating.
   * Lines that span the buffer boundary are accumulated in `partialLineBuffer`.
   *
   * @param buf - The buffer containing read data.
   * @param bytesRead - Number of bytes actually read.
   * @param bufferReadOffset - File offset where this buffer starts.
   * @returns True if processing should continue, false if a partial line needs more data.
   */
  const processBuffer = (buf: Buffer, bytesRead: number, bufferReadOffset: number) => {
    const rawBuf = buf.subarray(0, bytesRead);
    chunkBytes += bytesRead;
    reportProgress(bytesRead, 0, 0, 0);

    let localOffset = 0;

    if (partialLineBuffer !== null) {
      const firstNewline = rawBuf.indexOf(NEWLINE);
      const firstNewlineActual = firstNewline === -1 ? rawBuf.indexOf(0x0D) : firstNewline;
      if (firstNewlineActual === -1) {
        partialLineBuffer = Buffer.concat([partialLineBuffer, rawBuf]);
        if (partialLineBuffer.length > MAX_LINE_BYTES) {
          throw new Error(
            `Line exceeds maximum length (${MAX_LINE_BYTES} bytes) at offset ${partialLineBufferOffset} — input may be corrupt`,
          );
        }
        return false;
      }

      const sub = rawBuf.subarray(0, firstNewlineActual);
      const completedLine = Buffer.concat([partialLineBuffer, sub]);
      chunkLines += 1;
      const { stats, results: matchedResults } = parseBuffer(
        completedLine,
        SHA1_HEX_LENGTH,
        hashLookupMap,
        fingerprintSet,
        encoding,
        makePbOpts(partialLineBufferOffset),
      );
      results.push(...matchedResults);
      chunkMatched += stats.matchedHashCount;
      chunkLeaks += stats.cumulativeLeakCount;
      chunkRejected += stats.rejectedLineCount;
      pendingLines += 1;
      pendingMatched += stats.matchedHashCount;
      pendingLeaks += stats.cumulativeLeakCount;

      partialLineBuffer = null;
      localOffset = firstNewlineActual + 1;
    }

    const remaining = localOffset > 0 ? rawBuf.subarray(localOffset) : rawBuf;
    const lastNewline = remaining.lastIndexOf(NEWLINE);
    const lastNewlineActual = lastNewline === -1 ? remaining.lastIndexOf(0x0D) : lastNewline;

    if (lastNewlineActual === -1) {
      if (remaining.length > 0) {
        partialLineBuffer = Buffer.from(remaining);
        partialLineBufferOffset = bufferReadOffset + localOffset;
      }
      return false;
    }

    const completeSection = remaining.subarray(0, lastNewlineActual);

    const { stats, results: matchedResults } = parseBuffer(
      completeSection,
      SHA1_HEX_LENGTH,
      hashLookupMap,
      fingerprintSet,
      encoding,
      makePbOpts(bufferReadOffset + localOffset),
    );
    results.push(...matchedResults);
    chunkLines += stats.linesProcessed;
    chunkMatched += stats.matchedHashCount;
    chunkLeaks += stats.cumulativeLeakCount;
    chunkRejected += stats.rejectedLineCount;
    if (pendingLines > 0) {
      reportProgress(0, pendingLines, pendingMatched, pendingLeaks);
      pendingLines = 0;
      pendingMatched = 0;
      pendingLeaks = 0;
    }
    reportProgress(0, stats.linesProcessed, stats.matchedHashCount, stats.cumulativeLeakCount);

    const nextPartial = remaining.subarray(lastNewlineActual + 1);
    partialLineBuffer = nextPartial.length > 0 ? Buffer.from(nextPartial) : null;
    partialLineBufferOffset = bufferReadOffset + localOffset + lastNewlineActual + 1;
    return true;
  };

  // Bootstrap: fill first effectiveReadAhead slots
  let canRead = true;
  for (let i = 0; i < effectiveReadAhead && canRead; i += 1) {
    canRead = submitRead();
  }

  // Process ring buffer: wait for reads, submit new ones, parse completed buffers
  while (filled > 0) {
    const slot = readSlots[tail]!;

    // eslint-disable-next-line no-await-in-loop
    const { bytesRead } = await slot.promise;

    readSlots[tail] = null;
    tail = (tail + 1) % effectiveReadAhead;
    filled -= 1;

    if (bytesRead === 0) break;

    processBuffer(slot.buf, bytesRead, slot.offset);

    canRead &&= submitRead();
  }

  // Flush any remaining partial line for the last chunk
  if (desc.isLast) {
    const lastPartial = partialLineBuffer as Buffer | null;
    if (lastPartial && lastPartial.length > 0) {
      chunkLines += 1;
      const { stats, results: matchedResults } = parseBuffer(
        lastPartial,
        SHA1_HEX_LENGTH,
        hashLookupMap,
        fingerprintSet,
        encoding,
        makePbOpts(partialLineBufferOffset),
      );
      results.push(...matchedResults);
      chunkMatched += stats.matchedHashCount;
      chunkLeaks += stats.cumulativeLeakCount;
      chunkRejected += stats.rejectedLineCount;
      pendingLines += 1;
      pendingMatched += stats.matchedHashCount;
      pendingLeaks += stats.cumulativeLeakCount;
    }
  }

  if (pendingLines > 0) {
    reportProgress(0, pendingLines, pendingMatched, pendingLeaks);
  }

  return {
    results,
    bytesProcessed: chunkBytes,
    linesProcessed: chunkLines,
    matchedHashCount: chunkMatched,
    cumulativeLeakCount: chunkLeaks,
    rejectedLineCount: chunkRejected,
  };
}
