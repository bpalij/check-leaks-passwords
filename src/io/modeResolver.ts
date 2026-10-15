import fs from 'fs';

import type {
  PasswordObject,
  HashWithLeaksAndPasswordObjects,
  HashLookupEntry,
  OnProgress,
  SingleFileReadMode,
  ForcedReadMode,
} from '../types.js';
import { detectSortedness } from '../hashing/detectSortedness.js';
import { binarySearchReader } from './readModes/binarySearch.js';
import { indexReader } from './readModes/indexBased.js';
import {
  IDX_HEADER_SIZE,
  IDX_PREFIX_COUNT,
} from '../constants.js';
import { checkIndexHeader, decodeIndexHeader, hashTypeCodeFor } from './indexHeader.js';
import type { ReadModeEvaluation } from './readModeEvaluator.js';

export type { ReadModeEvaluation } from './readModeEvaluator.js';

/** Valid forced read mode values (from READ_MODE_FORCED env var). */
const VALID_FORCED_MODES: ForcedReadMode[] = [
  'binary',
  'index',
  'sequential-noindex',
  'sequential-index',
];

/**
 * Validate the READ_MODE_FORCED environment variable.
 *
 * @param envMode - Raw environment variable value.
 * @returns Validated forced mode, or undefined if not set.
 * @throws {Error} If the value is not a valid forced mode.
 */
export function validateForcedMode(
  envMode: string | undefined,
): ForcedReadMode | undefined {
  if (!envMode) return undefined;
  if (!VALID_FORCED_MODES.includes(envMode as ForcedReadMode)) {
    throw new Error(`READ_MODE_FORCED must be one of: ${VALID_FORCED_MODES.join(', ')}`);
  }
  return envMode as ForcedReadMode;
}

/**
 * Resolve the effective read mode from env override, user preference, and index flag.
 *
 * @param envMode - Forced mode from READ_MODE_FORCED env var.
 * @param singleFileReadMode - User-specified read mode preference.
 * @param buildIndex - Whether index building is requested.
 * @returns Resolved mode and whether to build an index.
 */
export function resolveMode(
  envMode: ForcedReadMode | undefined,
  singleFileReadMode: SingleFileReadMode | undefined,
  buildIndex: boolean,
): { mode: SingleFileReadMode; buildIdx: boolean } {
  if (envMode) {
    switch (envMode) {
      case 'binary':
        return { mode: 'binary', buildIdx: false };
      case 'index':
        return { mode: 'index', buildIdx: true };
      case 'sequential-noindex':
        return { mode: 'sequential', buildIdx: false };
      case 'sequential-index':
        return { mode: 'sequential', buildIdx: true };
      default:
        return { mode: singleFileReadMode ?? 'auto', buildIdx: buildIndex ?? false };
    }
  }
  return {
    mode: singleFileReadMode ?? 'auto',
    buildIdx: buildIndex ?? false,
  };
}

/**
 * Detect file sortedness and clean up stale index files.
 *
 * If the file is not sorted, deletes any existing `.idx` file since
 * binary search and index-based reading require sorted input.
 *
 * @param filePath - Path to the HIBP hashes file.
 * @param logger - Optional logging callback.
 * @param fullHashLength - Length of a full hex hash (40 for SHA-1, 32 for NTLM).
 *   Defaults to 40 (SHA-1).
 * @returns True if the file is sorted.
 */
export async function detectSortednessAndCleanup(
  filePath: string,
  logger?: (message: string) => void,
  fullHashLength?: number,
): Promise<boolean> {
  const sorted = await detectSortedness(filePath, fullHashLength);
  logger?.(`File sorted: ${sorted ? 'yes' : 'no'}`);
  if (!sorted) {
    logger?.('Warning: file not sorted');
    try { await fs.promises.unlink(`${filePath}.idx`); } catch { /* ok */ }
  }
  return sorted;
}

/**
 * Load a `.idx` file into a BigUint64Array.
 *
 * The index file contains an `IDX_HEADER_SIZE`-byte v2 header (sorted flag,
 * version marker, hash-type code, mtime, corpus file size) followed by
 * (IDX_PREFIX_COUNT + 1) 8-byte little-endian offsets.
 *
 * When `expected` is supplied, the header is validated against the corpus
 * being scanned; a legacy, wrong-hash-type or wrong-size index is rejected so
 * the caller can rebuild it instead of returning wrong offsets.
 *
 * @param idxPath - Path to the `.idx` file.
 * @param expected - Optional corpus metadata used to validate the header.
 * @param expected.hashType - Expected hash-type code.
 * @param expected.fileSize - Expected corpus file size in bytes.
 * @returns Array of file offsets indexed by 5-character prefix.
 * @throws {Error} If the file is truncated or fails metadata validation.
 * @security Index offsets only; contains no secret material.
 */
export async function loadIndex(
  idxPath: string,
  expected?: { hashType: number; fileSize: number },
): Promise<BigUint64Array> {
  const idxFile = await fs.promises.readFile(idxPath);
  const expectedSize = IDX_HEADER_SIZE + (IDX_PREFIX_COUNT + 1) * 8;
  if (idxFile.length < expectedSize) {
    throw new Error(
      `Index file "${idxPath}" is truncated: expected ${expectedSize} bytes, got ${idxFile.length}`,
    );
  }
  if (expected) {
    const check = checkIndexHeader(decodeIndexHeader(idxFile), expected);
    if (!check.ok) {
      throw new Error(`Index file "${idxPath}" is stale: ${check.reason}. Rebuild with auto-index.`);
    }
  }
  const arr = new BigUint64Array(IDX_PREFIX_COUNT + 1);
  for (let i = 0; i <= IDX_PREFIX_COUNT; i += 1) {
    arr[i] = idxFile.readBigUInt64LE(IDX_HEADER_SIZE + i * 8);
  }
  return arr;
}

/**
 * Try to load a fresh `.idx` file if it exists and is newer than the HIBP file.
 *
 * @param filePath - Path to the HIBP hashes file.
 * @param fileMtimeMs - Modification time of the HIBP file.
 * @param hashesWithPasswordObjects - Map for computing unique prefix count.
 * @param logger - Optional logging callback.
 * @param expected - Optional corpus metadata; when supplied, a stale `.idx`
 *   (wrong version, hash type or file size) is treated as absent.
 * @param expected.fullHashLength - Full hash length of the active hash type.
 * @param expected.fileSize - Corpus file size in bytes.
 * @returns The loaded index and unique prefix count, or null if not available.
 */
export async function tryLoadIndex(
  filePath: string,
  fileMtimeMs: number,
  hashesWithPasswordObjects: Map<string, Array<PasswordObject>>,
  logger?: (message: string) => void,
  expected?: { fullHashLength: number; fileSize: number },
): Promise<{ idx: BigUint64Array; uniquePrefixCount: number } | null> {
  const idxPath = `${filePath}.idx`;
  let idxStat: fs.Stats | undefined;
  try { idxStat = await fs.promises.stat(idxPath); } catch { return null; }
  if (!(idxStat.mtimeMs > fileMtimeMs)) return null;

  let idx: BigUint64Array;
  try {
    idx = await loadIndex(
      idxPath,
      expected && {
        hashType: hashTypeCodeFor(expected.fullHashLength),
        fileSize: expected.fileSize,
      },
    );
  } catch {
    return null;
  }
  logger?.('Fresh .idx found');
  const uniquePrefixes = new Set<number>();
  hashesWithPasswordObjects.forEach((_v, hash) => {
    uniquePrefixes.add(parseInt(hash.slice(0, 5), 16));
  });
  return { idx, uniquePrefixCount: uniquePrefixes.size };
}

/**
 * Format a human-readable log string comparing read mode estimates.
 *
 * @param ev - Read mode evaluation with timing estimates.
 * @param fmt - Duration formatting function.
 * @param forcedMode - Optional forced mode override.
 * @returns Formatted string like "Read modes: index 1.2s ✓ | sequential 5.3s".
 */
export function formatReadModeLog(
  ev: ReadModeEvaluation,
  fmt: (ms: number) => string,
  forcedMode?: ForcedReadMode,
): string {
  const parts: string[] = [];

  if (ev.idxTimeMs !== undefined) {
    const mark = ev.reader === 'index' || forcedMode === 'index' ? ' ✓' : '';
    parts.push(`index ${fmt(ev.idxTimeMs)}${mark}`);
  }

  if (ev.binTimeMs !== undefined) {
    const mark = ev.reader === 'binary' || forcedMode === 'binary' ? ' ✓' : '';
    parts.push(`binary ${fmt(ev.binTimeMs)}${mark}`);
  }

  parts.push(`sequential ${fmt(ev.seqTimeMs)}`);
  return `Read modes: ${parts.join(' | ')}`;
}

/**
 * Parameters for dispatching to the appropriate reader.
 */
export interface DispatchParams {
  filePath: string;
  fileSize: number;
  hashLookupMap: Map<number, HashLookupEntry[]>;
  fingerprintSet: Set<number> | null;
  encoding: BufferEncoding;
  idx?: BigUint64Array;
  hashesWithPasswordObjects: Map<string, Array<PasswordObject>>;
  logger?: (message: string) => void;
  onProgress?: OnProgress;
  isHDD: boolean;
  buildIdx?: boolean;
  sorted?: boolean;
  fullHashLength?: number;
  runSequential:
  (buildIdx?: boolean, sorted?: boolean) => Promise<HashWithLeaksAndPasswordObjects[]>;
}

/**
 * Dispatch to the best reader based on evaluation results.
 *
 * @param ev - Read mode evaluation result.
 * @param params - Reader parameters and callbacks.
 * @returns Enriched results with leak counts and password objects.
 */
export async function dispatchReader(
  ev: ReadModeEvaluation,
  params: DispatchParams,
): Promise<HashWithLeaksAndPasswordObjects[]> {
  if (ev.reader === 'index' && params.idx) {
    return indexReader(
      params.filePath,
      params.fileSize,
      params.hashLookupMap,
      params.fingerprintSet,
      params.encoding,
      params.idx,
      params.hashesWithPasswordObjects,
      params.logger,
      params.onProgress,
      params.isHDD,
      params.fullHashLength,
    );
  }
  if (ev.reader === 'binary') {
    return binarySearchReader(
      params.filePath,
      params.fileSize,
      params.hashLookupMap,
      params.fingerprintSet,
      params.encoding,
      params.hashesWithPasswordObjects,
      params.logger,
      params.onProgress,
      params.fullHashLength,
    );
  }
  return params.runSequential(params.buildIdx, params.sorted);
}
