import fs from 'fs';

/**
 * Byte length of every generated corpus line.
 *
 * Lines are fixed-width so callers can compute exact byte offsets:
 * 40 hex hash + ':' + 1 count digit + '\n'.
 */
export const LARGE_CORPUS_LINE_BYTES = 43;

/**
 * Number of consecutive lines that share the same 5-hex-char hash prefix.
 *
 * Hashes are ascending and grouped so the first 5 hex chars vary across the
 * file, which exercises the `.idx` prefix table with many distinct buckets.
 */
export const LARGE_CORPUS_LINES_PER_PREFIX = 256;

/**
 * Deterministic, ascending SHA-1-style hash for a given line index.
 *
 * The value sorts ascending with `index`, so a corpus written in index order
 * is always a sorted corpus. `index` is split into a 5-char prefix and a
 * 35-char suffix so that prefix buckets are densely represented.
 *
 * @param index - Zero-based line index.
 * @returns 40-character uppercase hexadecimal hash.
 */
export function largeCorpusHashForLine(index: number): string {
  const prefix = Math.floor(index / LARGE_CORPUS_LINES_PER_PREFIX);
  const suffix = index % LARGE_CORPUS_LINES_PER_PREFIX;
  return prefix.toString(16).toUpperCase().padStart(5, '0')
    + suffix.toString(16).toUpperCase().padStart(35, '0');
}

/**
 * Byte offset of a line in a corpus written by {@link writeLargeSha1Corpus}.
 *
 * @param index - Zero-based line index.
 * @returns Offset in bytes from the start of the file.
 */
export function largeCorpusOffsetForLine(index: number): number {
  return index * LARGE_CORPUS_LINE_BYTES;
}

/** A planted matching line in a generated corpus. */
export interface LargeCorpusMatch {
  /** Zero-based line index of the match. */
  index: number;
  /** The 40-character hexadecimal hash on that line. */
  hash: string;
  /** Leak count written on that line. */
  leaks: number;
}

/** Metadata describing a corpus written by {@link writeLargeSha1Corpus}. */
export interface LargeCorpus {
  /** Total number of lines written. */
  lineCount: number;
  /** Total file size in bytes. */
  byteLength: number;
  /** The planted matches, in ascending line-index order. */
  matches: LargeCorpusMatch[];
}

/**
 * Write a deterministic, ascending SHA-1-style corpus of at least `minBytes`.
 *
 * Every line is fixed-width ({@link LARGE_CORPUS_LINE_BYTES}) and sorted, so the
 * file is a valid input for the sortedness check and index builder. Lines at
 * `matchIndices` carry `matchLeaks` instead of `0`. The file is always sized to
 * at least one line past the highest match index.
 *
 * @param filePath - Destination path (created/truncated).
 * @param minBytes - Minimum desired file size in bytes. Tests that need the
 *   live sortedness check to run should size the corpus above the resolved
 *   `SMALL_FILE_BYTES_THRESHOLD` (96 KiB with the usual 64 KiB test override).
 * @param matchIndices - Line indices to plant as matches.
 * @param matchLeaks - Single-digit leak count written on matched lines.
 * @returns Metadata about the written corpus, including the planted matches.
 * @throws {Error} If `matchLeaks` is not a single digit (would break widths).
 */
export function writeLargeSha1Corpus(
  filePath: string,
  minBytes: number,
  matchIndices: number[] = [],
  matchLeaks = 9,
): LargeCorpus {
  if (String(matchLeaks).length !== 1) {
    throw new Error(`matchLeaks must be a single digit, got ${matchLeaks}`);
  }

  const uniqueIndices = [...new Set(matchIndices)].sort((a, b) => a - b);
  const maxMatch = uniqueIndices.length > 0 ? uniqueIndices[uniqueIndices.length - 1] : -1;
  const lineCount = Math.max(
    Math.ceil(minBytes / LARGE_CORPUS_LINE_BYTES),
    maxMatch + 1,
  );
  const matchSet = new Set(uniqueIndices);

  const fd = fs.openSync(filePath, 'w');
  try {
    // Write in fixed-size chunks to bound peak memory regardless of file size.
    const linesPerChunk = 65536;
    const chunk = Buffer.allocUnsafe(linesPerChunk * LARGE_CORPUS_LINE_BYTES);
    let index = 0;
    while (index < lineCount) {
      const count = Math.min(linesPerChunk, lineCount - index);
      let offset = 0;
      for (let j = 0; j < count; j += 1) {
        const i = index + j;
        const leak = matchSet.has(i) ? String(matchLeaks) : '0';
        chunk.write(`${largeCorpusHashForLine(i)}:${leak}\n`, offset, 'ascii');
        offset += LARGE_CORPUS_LINE_BYTES;
      }
      fs.writeSync(fd, chunk, 0, offset);
      index += count;
    }
  } finally {
    fs.closeSync(fd);
  }

  const byteLength = fs.statSync(filePath).size;
  const matches = uniqueIndices.map((i) => ({
    index: i,
    hash: largeCorpusHashForLine(i),
    leaks: matchLeaks,
  }));
  return { lineCount, byteLength, matches };
}
