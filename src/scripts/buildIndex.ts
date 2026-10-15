import fs from 'fs';
import v8 from 'v8';

import * as cliProgress from 'cli-progress';

import { createSpinner } from '../progress/createSpinner.js';
import { loadConfig } from '../envLoader.js';
import { sequentialReader } from '../io/readModes/sequential.js';
import { determineOptimalChunkCount } from '../memory/determineOptimalChunkCount.js';
import { detectSortedness } from '../hashing/detectSortedness.js';
import { detectSingleFileHashType, resolveActiveHashInfo } from '../hashing/detectHashType.js';
import type { HashType, HashTypeMismatchMode, ProgressUpdate } from '../types.js';

try { process.loadEnvFile(); } catch { /* .env is optional */ }

/** Valid `HASH_TYPE` values, mirroring `envLoader`. */
const VALID_HASH_TYPES: readonly HashType[] = [
  'auto',
  'sha1',
  'ntlm',
];

/** Valid `HASH_TYPE_MISMATCH` values, mirroring `envLoader`. */
const VALID_HASH_TYPE_MISMATCH_MODES: readonly HashTypeMismatchMode[] = ['error', 'warn'];

/**
 * Parse `HASH_TYPE` from the environment.
 *
 * The standalone index builder may run without the full run configuration
 * (`INPUT_PATH`/`OUTPUT_COUNT` may be absent), so it reads the hash-type
 * environment variables directly rather than via `loadConfig()`.
 *
 * @param env - Environment variables to read.
 * @returns The requested hash type (`auto` when unset or empty).
 * @throws {Error} If the value is non-empty and not a valid hash type.
 */
function resolveRequestedHashType(env: NodeJS.ProcessEnv): HashType {
  const raw = env.HASH_TYPE;
  if (raw === undefined || raw === '') return 'auto';
  if ((VALID_HASH_TYPES as readonly string[]).includes(raw)) return raw as HashType;
  throw new Error(`HASH_TYPE="${raw}" is invalid. Valid: ${VALID_HASH_TYPES.join(', ')}`);
}

/**
 * Parse `HASH_TYPE_MISMATCH` from the environment.
 *
 * @param env - Environment variables to read.
 * @returns The mismatch mode (`error` when unset or empty).
 * @throws {Error} If the value is non-empty and not a valid mismatch mode.
 */
function resolveMismatchMode(env: NodeJS.ProcessEnv): HashTypeMismatchMode {
  const raw = env.HASH_TYPE_MISMATCH;
  if (raw === undefined || raw === '') return 'error';
  if ((VALID_HASH_TYPE_MISMATCH_MODES as readonly string[]).includes(raw)) {
    return raw as HashTypeMismatchMode;
  }
  throw new Error(
    `HASH_TYPE_MISMATCH="${raw}" is invalid. Valid: ${VALID_HASH_TYPE_MISMATCH_MODES.join(', ')}`,
  );
}

/**
 * Resolve the effective hash type for the corpus and return its full hex length.
 *
 * Detection is content-based (never file-name based) and an explicit `HASH_TYPE`
 * takes precedence, with requested-vs-detected conflicts governed by
 * `HASH_TYPE_MISMATCH`.
 *
 * @param filePath - Path to the single-file corpus being indexed.
 * @returns The full hex hash length (40 for SHA-1, 32 for NTLM).
 * @throws {Error} If the config is invalid, the corpus is unreadable/ambiguous,
 *   or a requested-vs-detected mismatch is fatal.
 */
async function resolveFullHashLength(filePath: string): Promise<number> {
  const requested = resolveRequestedHashType(process.env);
  const mismatchMode = resolveMismatchMode(process.env);
  const detected = await detectSingleFileHashType(filePath);
  const { info } = resolveActiveHashInfo({
    requested,
    mismatchMode,
    isApiMode: false,
    detected,
  });
  console.log(`Hash type: ${info.type} (${info.source})`);
  return info.fullHashLength;
}

const filePath = process.argv[2] || loadConfig().hashesOfLeaksPath;
if (!filePath) {
  console.error('Error: no path provided and HASHES_OF_LEAKS_PATH is not set');
  process.exit(1);
}

let stat: fs.Stats;
try {
  stat = await fs.promises.stat(filePath);
} catch {
  console.error(`Error: file not found — ${filePath}`);
  process.exit(1);
}

const idxPath = `${filePath}.idx`;

let fullHashLength: number;
try {
  fullHashLength = await resolveFullHashLength(filePath);
} catch (err) {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${detail}`);
  process.exit(1);
}

// Remove any pre-existing index so that (a) sortedness is verified against the
// corpus content rather than a possibly stale/foreign index, and (b) the final
// "index produced" check below reflects this build only.
try { await fs.promises.unlink(idxPath); } catch { /* no existing index */ }

/**
 * CLI script to build an index file for a sorted HIBP data file.
 *
 * Verifies the file is sorted, determines optimal chunk count,
 * then performs a sequential scan to build the `.idx` index file.
 * The index maps the first 5 hex characters of each hash to its
 * byte offset in the data file.
 */
const sortSpinner = createSpinner('Checking sortedness...').start();
const verdict = await detectSortedness(filePath, fullHashLength);
if (verdict === 'skipped') {
  sortSpinner.stop();
  try { await fs.promises.unlink(idxPath); } catch { /* ok */ }
  console.error(
    `Error: cannot verify sortedness below 1 GiB — ${filePath} is too small to index. Aborting.`,
  );
  process.exit(1);
}
if (verdict === 'unsorted') {
  sortSpinner.stop();
  try { await fs.promises.unlink(idxPath); } catch { /* ok */ }
  console.error(`Error: ${filePath} is not sorted — index would be incorrect. Aborting.`);
  process.exit(1);
}
sortSpinner.succeed('File is sorted');

const chunkSpinner = createSpinner('Determining optimal chunk count...').start();
const { chunkCount } = await determineOptimalChunkCount(filePath, stat.size);
chunkSpinner.succeed(`Using ${chunkCount} chunk(s)`);

console.log('Building index (sequential scan with no hash lookups)...');
const bar = new cliProgress.SingleBar({
  format: 'Progress |{bar}| {percentage}% | {value}/{total} bytes',
  barCompleteChar: '\u2588',
  barIncompleteChar: '\u2591',
  hideCursor: true,
});
bar.start(stat.size, 0);

process.on('SIGINT', () => {
  bar.stop();
  process.exit(130);
});

try {
  await sequentialReader(
    filePath,
    stat.size,
    chunkCount,
    new Map(),
    // Workers unconditionally v8.deserialize the map payload; an empty map has
    // no hashes to look up, but must still be a valid serialized value.
    v8.serialize(new Map()),
    null,
    'ascii',
    new Map(),
    undefined,
    (update: ProgressUpdate) => {
      if (update.current !== undefined) bar.update(update.current);
    },
    true, // buildIdx
    true, // sorted
    undefined, // readAhead
    fullHashLength,
  );
} finally {
  bar.stop();
}

if (!fs.existsSync(idxPath)) {
  console.error(`Error: failed to build index for ${filePath} — no index was produced. Aborting.`);
  process.exit(1);
}

console.log(`\nIndex built: ${idxPath}`);
