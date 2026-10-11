import fs from 'fs';

import * as cliProgress from 'cli-progress';

import { createSpinner } from '../progress/createSpinner.js';
import { loadConfig } from '../envLoader.js';
import { sequentialReader } from '../io/readModes/sequential.js';
import { determineOptimalChunkCount } from '../memory/determineOptimalChunkCount.js';
import { detectSortedness } from '../hashing/detectSortedness.js';
import type { ProgressUpdate } from '../types.js';

try { process.loadEnvFile(); } catch { /* .env is optional */ }

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

/**
 * CLI script to build an index file for a sorted HIBP data file.
 *
 * Verifies the file is sorted, determines optimal chunk count,
 * then performs a sequential scan to build the `.idx` index file.
 * The index maps the first 5 hex characters of each hash to its
 * byte offset in the data file.
 */
const sortSpinner = createSpinner('Checking sortedness...').start();
const sorted = await detectSortedness(filePath);
if (!sorted) {
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
    Buffer.alloc(0),
    null,
    'ascii',
    new Map(),
    undefined,
    (update: ProgressUpdate) => {
      if (update.current !== undefined) bar.update(update.current);
    },
    true, // buildIdx
    true, // sorted
  );
} finally {
  bar.stop();
}

console.log(`\nIndex built: ${idxPath}`);
