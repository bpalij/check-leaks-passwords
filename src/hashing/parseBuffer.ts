/* eslint-disable no-bitwise */
import { HashLookupEntry } from '../types.js';
import { IDX_PREFIX_COUNT } from '../constants.js';

const NEWLINE = 0x0A;
const CARRIAGE_RETURN = 0x0D;
const COLON = 0x3A;

/**
 * Lookup table for hex character to nibble conversion.
 *
 * Pre-computed for ASCII characters '0'-'9', 'A'-'F', 'a'-'f'.
 * Used for fast hex parsing without parseInt overhead.
 */
const HEX_LOOKUP = new Uint8Array(128);
(() => {
  for (let i = 0x30; i <= 0x39; i += 1) HEX_LOOKUP[i] = i - 0x30;
  for (let i = 0x41; i <= 0x46; i += 1) HEX_LOOKUP[i] = i - 0x41 + 10;
  for (let i = 0x61; i <= 0x66; i += 1) HEX_LOOKUP[i] = i - 0x61 + 10;
})();

/**
 * Parse the first 5 hex characters of a line as a 20-bit prefix.
 *
 * Uses bitwise operations on the pre-computed HEX_LOOKUP for maximum
 * throughput. This is the hot path — called for every line in the HIBP file.
 *
 * @param buf - The buffer containing hex data.
 * @param off - Starting offset of the hex characters.
 * @returns 20-bit integer prefix (0..1048575).
 */
function parsePrefix(buf: Buffer, off: number): number {
  return (HEX_LOOKUP[buf[off]] << 16)
    | (HEX_LOOKUP[buf[off + 1]] << 12)
    | (HEX_LOOKUP[buf[off + 2]] << 8)
    | (HEX_LOOKUP[buf[off + 3]] << 4)
    | HEX_LOOKUP[buf[off + 4]];
}

/**
 * Statistics returned by `parseBuffer()`.
 *
 * @property linesProcessed - Total lines scanned in the buffer.
 * @property matchedHashCount - Number of lines that matched a hash in the lookup map.
 * @property cumulativeLeakCount - Sum of all leak counts for matched hashes.
 * @property rejectedLineCount - Number of lines with invalid format (non-numeric leak count).
 */
export interface ParseBufferResult {
  linesProcessed: number;
  matchedHashCount: number;
  cumulativeLeakCount: number;
  rejectedLineCount: number;
}

/**
 * Options for `parseBuffer()`.
 *
 * @property recordBoundary - Callback to record prefix boundary offsets for index building.
 * @property bufferFileOffset - File offset of the buffer start (for index recording).
 * @property lastPrefix - Mutable state tracking the last recorded prefix (avoids duplicates).
 */
export interface ParseBufferOptions {
  recordBoundary?: (prefix: number, offset: number) => void;
  bufferFileOffset?: number;
  lastPrefix?: { value: number };
}

/**
 * Parse a buffer of HIBP hash lines and match against a lookup map.
 *
 * This is the performance-critical hot path. Processes lines in the format
 * `SHA1_HEX:LEAK_COUNT` and matches against a pre-built lookup map.
 *
 * Uses a two-level lookup optimization:
 * 1. First 4 bytes (key1) for map lookup — avoids string comparison.
 * 2. Fifth nibble (fifthVal) for fingerprint filtering — reduces candidates.
 *
 * @param buffer - The buffer containing HIBP hash lines.
 * @param hashLength - Expected hash length (40 for file, 35 for API).
 * @param hashLookupMap - Map from 4-byte key to candidate hash entries.
 * @param fingerprintSet - Optional set of first-4-byte keys for fast rejection.
 * @param encoding - Buffer encoding for hash string comparison.
 * @param options - Optional index recording and offset tracking.
 * @returns Matched results and processing statistics.
 */
export function parseBuffer(
  buffer: Buffer,
  hashLength: number,
  hashLookupMap: Map<number, HashLookupEntry[]>,
  fingerprintSet: Set<number> | null,
  encoding: BufferEncoding,
  options?: ParseBufferOptions,
): {
  stats: ParseBufferResult;
  results: Array<{ hash: string; leaks: number }>;
} {
  const results: Array<{ hash: string; leaks: number }> = [];
  let linesProcessed = 0;
  let matchedHashCount = 0;
  let cumulativeLeakCount = 0;
  let rejectedLineCount = 0;
  let lineStart = 0;
  const len = buffer.length;
  const skipBytes = 40 - hashLength;
  let lastKey1 = -1;
  let lastCandidates: HashLookupEntry[] | undefined;
  let lastFifthVal = -1;

  while (lineStart < len) {
    let nl = buffer.indexOf(NEWLINE, lineStart);
    if (nl === -1) nl = buffer.indexOf(CARRIAGE_RETURN, lineStart);

    let lineEnd: number;
    if (nl === -1) {
      lineEnd = len;
    } else if (nl > lineStart && buffer[nl - 1] === CARRIAGE_RETURN) {
      lineEnd = nl - 1;
    } else {
      lineEnd = nl;
    }
    linesProcessed += 1;

    if (lineEnd - lineStart >= hashLength) {
      const off = lineStart;
      // key1: first 4 bytes as a 32-bit integer for fast map lookup
      const key1 = buffer[off] * 0x1000000 + buffer[off + 1] * 0x10000
        + buffer[off + 2] * 0x100 + buffer[off + 3];
      const fifthVal = HEX_LOOKUP[buffer[off + 4]];

      if (key1 !== lastKey1 || fifthVal !== lastFifthVal) {
        if (options?.recordBoundary && options?.lastPrefix) {
          const prefix = parsePrefix(buffer, off);
          if (prefix !== options.lastPrefix.value && prefix < IDX_PREFIX_COUNT) {
            options.recordBoundary(prefix, (options.bufferFileOffset ?? 0) + off);
            options.lastPrefix.value = prefix; // eslint-disable-line no-param-reassign
          }
        }
        if (key1 !== lastKey1) {
          lastKey1 = key1;
          // Fingerprint optimization: skip map lookup if key1 not in fingerprint set
          if (fingerprintSet) {
            lastCandidates = fingerprintSet.has(key1) ? hashLookupMap.get(key1) : undefined;
          } else {
            lastCandidates = hashLookupMap.get(key1);
          }
        }
        lastFifthVal = fifthVal;
      }

      if (lastCandidates) {
        for (let ci = 0; ci < lastCandidates.length; ci += 1) {
          const c = lastCandidates[ci];
          const target = c.fullHashBytes;
          let match = true;
          const startK = skipBytes === 0 ? 4 : 0;
          // Compare remaining bytes after the first 4 (already matched via key1).
          // Reverse scan: mismatches are more likely at the end (leak count suffix),
          // so starting from the tail avoids scanning the full hash on rejection.
          for (let k = hashLength - 1; k >= startK; k -= 1) {
            if (target[skipBytes + k] !== buffer[off + k]) {
              match = false;
              break;
            }
          }
          // eslint-disable-next-line no-continue
          if (!match) continue;

          // Find the colon separator after the hash
          let colonPos = -1;
          if (lineEnd - off > hashLength && buffer[off + hashLength] === COLON) {
            colonPos = off + hashLength;
          } else {
            for (let j = off; j < lineEnd; j += 1) {
              if (buffer[j] === COLON) { colonPos = j; break; }
            }
          }

          if (colonPos === -1) break;

          // Parse the leak count after the colon
          let leakEnd = lineEnd;
          if (leakEnd > colonPos + 1 && buffer[leakEnd - 1] === CARRIAGE_RETURN) {
            leakEnd -= 1;
          }
          let leakCount = 0;
          for (let i = colonPos + 1; i < leakEnd; i += 1) {
            const byte = buffer[i];
            if (byte < 0x30 || byte > 0x39) {
              rejectedLineCount += 1;
              leakCount = -1;
              break;
            }
            leakCount = leakCount * 10 + (byte - 48);
          }

          if (leakCount >= 0 && leakCount > Number.MAX_SAFE_INTEGER) {
            rejectedLineCount += 1;
            break;
          }

          if (leakCount >= 0) {
            matchedHashCount += 1;
            cumulativeLeakCount += leakCount;
            if (leakCount > 0) {
              results.push({
                hash: c.fullHash,
                leaks: leakCount,
              });
            }
          }
          break;
        }
      }
    }

    if (nl === -1) break;
    lineStart = nl + 1;
  }

  return {
    stats: {
      linesProcessed,
      matchedHashCount,
      cumulativeLeakCount,
      rejectedLineCount,
    },
    results,
  };
}
