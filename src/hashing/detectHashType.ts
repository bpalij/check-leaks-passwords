import fs from 'fs/promises';
import path from 'path';

import {
  HIBP_API_HASH_LENGTH,
  NTLM_API_HASH_SUFFIX_LENGTH,
  NTLM_HEX_LENGTH,
  SHA1_HEX_LENGTH,
  apiSuffixLengthFor,
  fullHashLengthFor,
} from '../constants.js';
import type { ActiveHashInfo, HashType, HashTypeMismatchMode } from '../types.js';

/** Outcome of sampling a local corpus's content for the hash type. */
export type DetectedHashType = 'sha1' | 'ntlm' | 'unknown' | 'ambiguous';

/**
 * Result of content-based hash-type detection.
 *
 * @property type - The detected type, or `unknown` (no non-empty sample) /
 *   `ambiguous` (mixed or malformed lengths).
 * @property sampleLength - The hash-part length that drove a confident result.
 */
export interface DetectionResult {
  type: DetectedHashType;
  sampleLength?: number;
}

/** Maximum number of bytes sampled from a corpus when detecting the hash type. */
export const DETECTION_SAMPLE_BYTES = 64 * 1024;

/** Maximum number of prefix files inspected when detecting a split directory's type. */
export const DETECTION_MAX_SPLIT_FILES = 32;

/**
 * Matches split-prefix file names (a 5-hex prefix with an optional `.txt`
 * extension). Used only to select which files to sample — the hash type itself
 * is always derived from file contents, never from the name. This excludes
 * stray files (README, `.DS_Store`, checksums) that are not corpus data.
 */
const SPLIT_FILE_NAME = /^[0-9a-fA-F]{5}(\.txt)?$/;

/** Maps a full single-file hash-part length to an effective hash type. */
const SINGLE_FILE_LENGTHS: Record<number, 'sha1' | 'ntlm'> = {
  [SHA1_HEX_LENGTH]: 'sha1',
  [NTLM_HEX_LENGTH]: 'ntlm',
};

/** Maps a split-file suffix length to an effective hash type. */
const SPLIT_SUFFIX_LENGTHS: Record<number, 'sha1' | 'ntlm'> = {
  [HIBP_API_HASH_LENGTH]: 'sha1',
  [NTLM_API_HASH_SUFFIX_LENGTH]: 'ntlm',
};

/**
 * Extract the hash-part length of a corpus line (the part before the separator).
 *
 * Blank lines (after trimming CR/LF and surrounding whitespace) return `null`.
 *
 * @param line - A single raw corpus line (may include a trailing `\r`).
 * @returns The trimmed length of the hash part, or `null` for blank lines.
 */
function hashPartLength(line: string): number | null {
  const trimmed = line.replace(/\r$/, '').trim();
  if (!trimmed) return null;
  const colon = trimmed.indexOf(':');
  const hashPart = colon === -1 ? trimmed : trimmed.slice(0, colon);
  return hashPart.trim().length;
}

/**
 * Collect the distinct hash-part lengths of non-empty lines in a buffer.
 *
 * @param buf - The sampled bytes.
 * @param truncated - True when the buffer may be a prefix of a larger file, in
 *   which case a trailing partial line is ignored.
 * @returns The set of distinct hash-part lengths observed.
 */
function collectLengths(buf: Buffer, truncated: boolean): Set<number> {
  const text = buf.toString('latin1');
  const lines = text.split('\n');
  if (truncated && !text.endsWith('\n')) lines.pop();
  const lengths = new Set<number>();
  lines.forEach((line) => {
    const len = hashPartLength(line);
    if (len !== null) lengths.add(len);
  });
  return lengths;
}

/**
 * Classify a set of observed hash-part lengths against a length→type map.
 *
 * @param lengths - Distinct hash-part lengths observed.
 * @param map - Mapping from a known length to an effective hash type.
 * @returns A confident result, or `unknown`/`ambiguous`.
 */
function classify(lengths: Set<number>, map: Record<number, 'sha1' | 'ntlm'>): DetectionResult {
  if (lengths.size === 0) return { type: 'unknown' };
  if (lengths.size > 1) return { type: 'ambiguous' };
  const [len] = lengths;
  const type = map[len];
  if (!type) return { type: 'ambiguous', sampleLength: len };
  return { type, sampleLength: len };
}

/**
 * Read up to `DETECTION_SAMPLE_BYTES` from the start of a file.
 *
 * @param filePath - The file to sample.
 * @returns The sampled bytes (empty when the file is empty).
 * @throws {Error} If the file cannot be read.
 */
async function readPrefix(filePath: string): Promise<Buffer> {
  const handle = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(DETECTION_SAMPLE_BYTES);
    const { bytesRead } = await handle.read(buf, 0, DETECTION_SAMPLE_BYTES, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Detect the hash type of a single-file corpus from its first non-empty lines.
 *
 * Never uses the file name. Ignores CRLF/LF and blank lines.
 *
 * @param filePath - Path to the single-file corpus.
 * @returns The detection result (never throws for format reasons).
 * @throws {Error} If the file cannot be read.
 */
export async function detectSingleFileHashType(filePath: string): Promise<DetectionResult> {
  const buf = await readPrefix(filePath);
  return classify(collectLengths(buf, buf.length === DETECTION_SAMPLE_BYTES), SINGLE_FILE_LENGTHS);
}

/**
 * Detect the hash type of a split-prefix directory from non-empty file contents.
 *
 * Never uses file names. Inspects up to `DETECTION_MAX_SPLIT_FILES` non-empty
 * files and classifies the suffix lengths observed.
 *
 * @param dirPath - Path to the split-prefix directory.
 * @returns The detection result (never throws for format reasons).
 * @throws {Error} If the directory cannot be read.
 */
export async function detectSplitDirectoryHashType(dirPath: string): Promise<DetectionResult> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && SPLIT_FILE_NAME.test(e.name))
    .map((e) => e.name)
    .sort();
  const candidates = files.slice(0, DETECTION_MAX_SPLIT_FILES);
  const prefixes = await Promise.all(
    candidates.map((name) => readPrefix(path.join(dirPath, name))),
  );

  const lengths = new Set<number>();
  prefixes.forEach((buf) => {
    if (buf.length === 0) return;
    collectLengths(buf, buf.length === DETECTION_SAMPLE_BYTES).forEach((len) => lengths.add(len));
  });
  return classify(lengths, SPLIT_SUFFIX_LENGTHS);
}

/**
 * Detect the hash type of a local corpus (single file or split-prefix directory).
 *
 * @param corpusPath - Path to the corpus file or directory.
 * @returns The detection result.
 * @throws {Error} If the corpus cannot be read or is otherwise inaccessible.
 */
export async function detectLocalHashType(corpusPath: string): Promise<DetectionResult> {
  try {
    const stat = await fs.stat(corpusPath);
    if (stat.isDirectory()) return await detectSplitDirectoryHashType(corpusPath);
    return await detectSingleFileHashType(corpusPath);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Unable to read corpus for hash-type detection: "${corpusPath}" (${detail})`);
  }
}

/**
 * Parameters for resolving the effective hash type for a run.
 *
 * @property requested - The requested hash type (may be `auto`).
 * @property mismatchMode - Governance mode for requested-vs-detected conflicts.
 * @property isApiMode - True when checking against the HIBP API (no local corpus).
 * @property detected - Detection result for the local corpus; omitted in API mode.
 */
export interface ResolveHashTypeParams {
  requested: HashType;
  mismatchMode: HashTypeMismatchMode;
  isApiMode: boolean;
  detected?: DetectionResult;
}

/**
 * The resolved effective hash type for a run, plus any message to surface.
 *
 * @property info - The canonical active hash info to thread through the run.
 * @property warning - Set when warn-mode self-correction occurred.
 * @property notice - Set when an informational notice must be shown (API + auto).
 */
export interface ResolvedHashType {
  info: ActiveHashInfo;
  warning?: string;
  notice?: string;
}

/**
 * Build a canonical {@link ActiveHashInfo} for an effective hash type.
 *
 * @param requested - The originally requested hash type.
 * @param type - The effective hash type.
 * @param source - How the effective type was chosen.
 * @param mismatchMode - The active mismatch governance mode.
 * @returns The canonical active hash info.
 */
function makeInfo(
  requested: HashType,
  type: 'sha1' | 'ntlm',
  source: ActiveHashInfo['source'],
  mismatchMode: HashTypeMismatchMode,
): ActiveHashInfo {
  return {
    requested,
    type,
    fullHashLength: fullHashLengthFor(type),
    apiSuffixLength: apiSuffixLengthFor(type),
    source,
    mismatchMode,
  };
}

/**
 * Resolve the effective hash type and enforce mismatch/unreadable governance.
 *
 * Rules:
 * - API mode + `auto` resolves to `sha1` and returns a notice (no local corpus).
 * - Local `auto` trusts a confident detection; `unknown`/`ambiguous` aborts.
 * - Explicit type with a confidently-detected different type aborts (`error`)
 *   or self-corrects to the detected type (`warn`).
 * - `unknown`/`ambiguous` detection aborts in BOTH modes.
 *
 * @param params - The resolution parameters.
 * @returns The resolved active hash info and any message to surface.
 * @throws {Error} When detection is unknown/ambiguous or a mismatch is fatal.
 */
export function resolveActiveHashInfo(params: ResolveHashTypeParams): ResolvedHashType {
  const {
    requested, mismatchMode, isApiMode, detected,
  } = params;

  if (isApiMode) {
    if (requested === 'auto') {
      return {
        info: makeInfo(requested, 'sha1', 'api-default', mismatchMode),
        notice: 'HASH_TYPE=auto has no corpus to examine in API mode; using sha1. '
          + 'Set HASH_TYPE=ntlm to check NTLM hashes against the HIBP API.',
      };
    }
    return { info: makeInfo(requested, requested, 'explicit', mismatchMode) };
  }

  const detection = detected;
  if (!detection || detection.type === 'unknown') {
    throw new Error(
      'Could not detect the hash type: the corpus contains no non-empty hash lines. '
      + 'Provide a valid HIBP SHA-1 or NTLM corpus, or set HASH_TYPE=sha1 or HASH_TYPE=ntlm explicitly.',
    );
  }
  if (detection.type === 'ambiguous') {
    const detail = detection.sampleLength !== undefined ? ` (unexpected hash-part length ${detection.sampleLength})` : '';
    throw new Error(
      'Could not detect the hash type: the corpus mixes hash types or contains malformed lines'
      + `${detail}. Refusing to guess; provide a corpus with a single consistent hash format.`,
    );
  }

  if (requested === 'auto') {
    return { info: makeInfo(requested, detection.type, 'detected', mismatchMode) };
  }

  if (requested === detection.type) {
    return { info: makeInfo(requested, requested, 'explicit', mismatchMode) };
  }

  if (mismatchMode === 'error') {
    throw new Error(
      `HASH_TYPE=${requested} was requested, but the corpus contains ${detection.type} hashes. `
      + `Set HASH_TYPE=auto or HASH_TYPE=${detection.type}, or set HASH_TYPE_MISMATCH=warn to auto-correct.`,
    );
  }

  return {
    info: makeInfo(requested, detection.type, 'corrected', mismatchMode),
    warning: `HASH_TYPE=${requested} was requested, but the corpus contains ${detection.type} hashes; `
      + `auto-correcting to ${detection.type} (HASH_TYPE_MISMATCH=warn).`,
  };
}
