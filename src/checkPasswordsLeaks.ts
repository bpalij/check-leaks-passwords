import crypto from 'crypto';
import fs from 'fs';
import os from 'os';

import chalk from 'chalk';
import * as cliProgress from 'cli-progress';
import stringWidth from 'string-width';

import { createSpinner } from './progress/createSpinner.js';
import { validateConfig } from './validateConfig.js';
import { inputHandlers, outputHandlers } from './handlers/index.js';
import { formatNumber } from './formatting/formatNumber.js';
import { formatBytes } from './formatting/formatBytes.js';
import { formatCompact } from './formatting/formatCompact.js';
import { extractPassword } from './crypto/extractPassword.js';
import type {
  ConfigInterface,
  PasswordObject,
  OnProgress,
  ProgressUpdate,
} from './types.js';
import { processDataLeaks } from './io/processDataLeaks.js';
import { formatDuration } from './formatting/formatDuration.js';
import { processHibpApi } from './io/processHibpApi.js';
import { HIBP_API_URL } from './constants.js';

process.env.UV_THREADPOOL_SIZE ??= String(os.availableParallelism());

/**
 * Format seconds into a compact time string.
 *
 * @param seconds - Duration in seconds.
 * @returns Formatted string like "1h30m", "5m30s", or "30s".
 */
const formatTimeCompact = (seconds: number): string => {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h${String(m).padStart(2, '0')}m`;
  }
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m${String(s).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
};

const bar = new cliProgress.SingleBar({
  format(options, params, payload) {
    const cols = process.stdout.columns ?? 80;
    const phase = payload.phase || '';
    const val = payload.valStr || '';
    const total = payload.totalStr || '';
    const speed = payload.speedStr || '';
    const stopTime = params.stopTime || Date.now();
    const elapsedSec = Math.max(0, Math.round((stopTime - params.startTime) / 1000));
    const dur = formatTimeCompact(elapsedSec).padStart(6);

    const rawEta: number | string = params.eta as number | string;
    const etaVal = (rawEta === 'NULL' || rawEta === 'INF' || Number(rawEta) <= 0)
      ? '-'
      : formatTimeCompact(Number(rawEta));
    const eta = etaVal === '-' ? etaVal.padStart(7) : `~${etaVal}`.padStart(7);
    const prefix = chalk.cyan(phase);
    const pct = `${Math.round(params.progress * 100)}`.padStart(3);
    const suffix = `${chalk.white(`${pct}%`)}${chalk.dim('|')}`
      + `${chalk.white(`${val}/${total}`)}${chalk.dim('|')}`
      + `${chalk.white(speed)}${chalk.dim('|')}`
      + `${chalk.white(dur)}${chalk.dim('|')}`
      + `${chalk.white(eta)}`;
    const barSize = Math.max(3, Math.min(cols - stringWidth(prefix) - stringWidth(suffix) - 2, 60));
    const filled = Math.round(params.progress * barSize);
    const arrow = filled > 0 && filled < barSize ? chalk.bold.green('▶') : '';
    const barStr = chalk.green('='.repeat(filled)) + arrow + chalk.dim('-'.repeat(barSize - filled - (arrow ? 1 : 0)));
    return `${prefix}${chalk.dim('[')}${barStr}${chalk.dim(']')}${suffix}`;
  },
  hideCursor: true,
  clearOnComplete: false,
  stream: process.stdout,
});

/**
 * Register a process exit handler to restore the cursor.
 *
 * Called once at module load time. Ensures the terminal cursor is visible
 * even if the process exits unexpectedly.
 */
export const registerExitHandler = () => {
  process.on('exit', () => {
    bar.stop();
    process.stdout.write('\x1b[?25h');
  });
};

registerExitHandler();

/**
 * Format a number according to the progress update format hint.
 *
 * @param n - The number to format.
 * @param fmt - Format hint from ProgressUpdate.
 * @returns Formatted string.
 */
const formatNum = (n: number, fmt: ProgressUpdate['format']) => {
  if (fmt === 'bytes') return formatBytes(n);
  if (fmt === 'compact') return formatCompact(n);
  return formatNumber(n);
};

/**
 * Format a speed value (per second) according to the format hint.
 *
 * @param n - The speed value.
 * @param fmt - Format hint from ProgressUpdate.
 * @returns Formatted string with "/s" suffix.
 */
const formatSpeed = (n: number, fmt: ProgressUpdate['format']) => {
  const suffix = '/s';
  if (fmt === 'bytes') return formatBytes(n) + suffix;
  if (fmt === 'compact') return formatCompact(n) + suffix;
  return formatNumber(n) + suffix;
};

type BarPayload = {
  phase: string; speedStr: string; valStr: string; totalStr: string;
};

/**
 * Create the initial progress bar payload before any updates arrive.
 *
 * @param phaseName - Phase name for display.
 * @param fmt - Number format hint.
 * @param tw - Total value string width.
 * @param totalStr - Formatted total string.
 * @returns Payload object for the progress bar.
 */
function makeStartPayload(phaseName: string, fmt: ProgressUpdate['format'], tw: number, totalStr: string): BarPayload {
  if (fmt === 'compact') {
    return {
      phase: phaseName, speedStr: `${'\u2014'.padStart(6)}/s`, valStr: formatNum(0, fmt).padStart(6), totalStr,
    };
  }
  if (fmt === 'bytes') {
    return {
      phase: phaseName, speedStr: `${'\u2014'.padStart(7)}/s`, valStr: formatNum(0, fmt).padStart(7), totalStr,
    };
  }
  return {
    phase: phaseName, speedStr: '\u2014/s'.padStart(tw + 2), valStr: formatNum(0, fmt).padStart(tw), totalStr,
  };
}

/**
 * Create a progress bar update payload from a ProgressUpdate.
 *
 * @param phase - Phase name for display.
 * @param update - The progress update.
 * @param fmt - Number format hint.
 * @param tw - Total value string width.
 * @returns Payload object for the progress bar.
 */
function makeUpdatePayload(phase: string, update: ProgressUpdate, fmt: ProgressUpdate['format'], tw: number): BarPayload {
  let speedWidth: number;
  if (fmt === 'compact') {
    speedWidth = 8;
  } else if (fmt === 'bytes') {
    speedWidth = 9;
  } else {
    speedWidth = tw + 2;
  }
  if (fmt === 'compact') {
    return {
      phase,
      speedStr: (update.speed ? formatSpeed(update.speed, fmt) : '\u2014/s').padStart(speedWidth),
      valStr: formatNum(update.current, fmt).padStart(6),
      totalStr: formatNum(update.total, fmt),
    };
  }
  if (fmt === 'bytes') {
    return {
      phase,
      speedStr: (update.speed ? formatSpeed(update.speed, fmt) : '\u2014/s').padStart(speedWidth),
      valStr: formatNum(update.current, fmt).padStart(7),
      totalStr: formatNum(update.total, fmt),
    };
  }
  return {
    phase,
    speedStr: update.speed ? formatSpeed(update.speed, fmt).padStart(speedWidth) : '\u2014/s'.padStart(speedWidth),
    valStr: formatNum(update.current, fmt).padStart(tw),
    totalStr: formatNum(update.total, fmt),
  };
}

/**
 * Wrap an async operation with a progress bar phase.
 *
 * Shows a header message, starts the progress bar on first update,
 * and handles success/failure with proper cleanup.
 *
 * @template T - Return type of the wrapped function.
 * @param phaseName - Name of the phase for display.
 * @param headerText - Text shown before the progress bar starts.
 * @param fn - The async operation to wrap. Receives onProgress and log callbacks.
 * @returns The result of the wrapped function.
 */
const makePhase = <T>(
  phaseName: string,
  headerText: string,
  fn: (onProgress: OnProgress, log: (msg: string) => void) => Promise<T>,
): Promise<T> => {
  let barStarted = false;
  let tw = 0;
  process.stdout.write(`${headerText}...`);
  const log = (msg: string) => {
    if (barStarted) {
      bar.stop();
      barStarted = false;
    }
    process.stdout.write(`${msg}\n`);
  };
  return fn(
    (update) => {
      const fmt = update.format;
      if (!barStarted) {
        if (update.workers !== undefined && (update.phase || phaseName) !== 'Scan file') {
          process.stdout.write(`Using ${update.workers} concurrency\n`);
        }
        const totalStr = formatNum(update.total, fmt);
        tw = totalStr.length;
        if (fmt === 'bytes') tw = Math.max(tw, 7);
        bar.start(update.total, 0, makeStartPayload(update.phase || phaseName, fmt, tw, totalStr));
        barStarted = true;
      }
      bar.update(update.current, makeUpdatePayload(update.phase || phaseName, update, fmt, tw));
    },
    log,
  ).then(
    (result) => {
      if (barStarted) bar.stop();
      return result;
    },
    (err: unknown) => {
      if (barStarted) bar.stop();
      log(`${chalk.red('✖')} ${phaseName}: ${(err as Error).message}`);
      throw err;
    },
  );
};

/**
 * Main pipeline: check Bitwarden passwords against HIBP data.
 *
 * Orchestrates the full scan pipeline:
 * 1. Validate configuration.
 * 2. Auto-detect input format (CSV or JSON).
 * 3. Read input file (handles encrypted exports).
 * 4. Hash passwords with SHA-1.
 * 5. Scan HIBP data (file or API) for each hash.
 * 6. Sort results by leak count (descending).
 * 7. Write output (CSV or JSON, with optional secret stripping).
 *
 * @param config - Validated tool configuration.
 * @param options - Optional overrides.
 * @param options.dryRun - Show summary without scanning.
 * @param logger - Logger for status messages (default: console).
 * @throws {Error} If the input has no passwords or an output format is unknown.
 *
 * @security Zeroes the export password in the finally block.
 *   Hashes and password objects are cleared from memory after use.
 */
export async function checkPasswordsLeaks(
  config: ConfigInterface,
  options?: { dryRun?: boolean },
  logger: Console = console,
): Promise<void> {
  await validateConfig(config);

  const startInstant = Temporal.Now.instant();

  // Auto-detect: JSON vaults start with '{' (0x7B), CSV HIBP exports start with a hex hash char
  await using fd = await fs.promises.open(config.inputPath, 'r');
  const buf = Buffer.alloc(1);
  await fd.read(buf, 0, 1, 0);
  const inputFormat = buf[0] === 0x7b ? 'json' : 'csv';
  process.stdout.write(`Input format: ${inputFormat}\n`);

  let input: PasswordObject[] | null = null;
  let hashesMap: Map<string, Array<PasswordObject>> | null = null;
  let hashCache: Map<string, string> | null = null;
  type LeakGroup = {
    hash: string;
    leaks: number;
    passwordObjects: PasswordObject[];
  };
  let dataWithLeaks: LeakGroup[] | null = null;

  try {
    const readSpinner = createSpinner('Reading input file...').start();
    let readSpinnerStopped = false;
    const inputHandler = inputHandlers[inputFormat];
    input = await inputHandler(config.inputPath, config.exportPassword, () => {
      readSpinnerStopped = true;
      readSpinner.succeed('Reading input file');
    });
    if (!input.length) {
      if (!readSpinnerStopped) readSpinner.fail('No non-empty passwords found in the input file');
      throw new Error('No non-empty passwords found in the input file. Check that the file is a valid Bitwarden export.');
    }
    if (!readSpinnerStopped) {
      readSpinner.succeed(`Found ${formatNumber(input.length)} correct not-empty passwords in input file`);
    }

    hashesMap = new Map();
    hashCache = new Map();

    const hashSpinner = createSpinner('Hashing passwords...').start();
    const inputCount = input!.length;
    input!.forEach((obj) => {
      const password = extractPassword(obj)!;
      const hash = hashCache!.getOrInsertComputed(password, () => crypto.hash('sha1', password, 'hex').toUpperCase());
      hashesMap!.getOrInsert(hash, []).push(obj);
    });
    const uniqueHashCount = hashesMap!.size;
    const dedupMsg = inputCount !== uniqueHashCount
      ? `Hashing passwords (${formatNumber(inputCount)} total → ${formatNumber(uniqueHashCount)} unique)`
      : 'Hashing passwords';
    hashSpinner.succeed(dedupMsg);

    // input no longer needed after hashing
    if (input) { input.length = 0; input = null; }

    if (options?.dryRun) {
      const uniqueHashes = hashesMap.size;
      process.stdout.write('\n--- Dry Run Summary ---\n');
      process.stdout.write(`Passwords found:  ${formatNumber(inputCount)}\n`);
      process.stdout.write(`Unique hashes:    ${formatNumber(uniqueHashes)}\n`);
      process.stdout.write(`Input format:     ${inputFormat}\n`);
      if (!config.useHibpApi) {
        process.stdout.write(`Hashes file:      ${config.hashesOfLeaksPath}\n`);
      } else {
        process.stdout.write('Mode:             HIBP API (k-anonymity)\n');
      }
      process.stdout.write(`Read mode:        ${config.singleFileReadMode}\n`);
      return;
    }

    if (config.useHibpApi) {
      dataWithLeaks = await makePhase('Query API', 'Querying API', async (onPhaseProgress, log) => {
        const apiUrl = config.hibpApiUrl ?? HIBP_API_URL;
        const result = await processHibpApi(hashesMap!, apiUrl, log, onPhaseProgress, (msg) => process.stderr.write(`${msg}\n`));
        return result;
      });
    } else {
      dataWithLeaks = await makePhase('Scan file', 'Scanning file', async (onPhaseProgress, log) => {
        const result = await processDataLeaks(
          hashesMap!,
          config.hashesOfLeaksPath,
          'ascii',
          log,
          onPhaseProgress,
          config.singleFileReadMode,
          config.buildIndex,
        );
        return result;
      });
    }

    // hashes no longer needed after scan
    hashesMap!.clear();
    hashesMap = null;
    hashCache!.clear();
    hashCache = null;

    const sortSpinner = createSpinner('Sorting output by leaks DESC...').start();
    dataWithLeaks.sort((a, b) => {
      if (a.leaks > b.leaks) return -1;
      if (a.leaks < b.leaks) return 1;
      return 0;
    });
    sortSpinner.succeed('Sorting output by leaks DESC');

    const leakedPasswordCount = dataWithLeaks.reduce((sum, g) => sum + g.passwordObjects.length, 0);
    const safeCount = inputCount - leakedPasswordCount;
    process.stdout.write(
      `${formatNumber(leakedPasswordCount)} password(s) leaked`
      + ` out of ${formatNumber(leakedPasswordCount + safeCount)} total`
      + ` (${formatNumber(safeCount)} safe)\n`,
    );

    const writeSpinner = createSpinner('Writing output...').start();
    for (let i = 0; i < config.outputs.length; i += 1) {
      const output = config.outputs[i];
      const handler = outputHandlers[output.format];
      if (!handler) {
        writeSpinner.fail(`Unknown output format: ${output.format}`);
        throw new Error(`Unknown output format: ${output.format}`);
      }
      // eslint-disable-next-line no-await-in-loop
      await handler(output.path, dataWithLeaks, { includeSecrets: config.includeSecrets });
    }
    writeSpinner.succeed('Writing output');

    // dataWithLeaks no longer needed after output
    dataWithLeaks!.length = 0;
    dataWithLeaks = null;

    const endInstant = Temporal.Now.instant();
    logger.log(`Finished in ${formatDuration(startInstant, endInstant)}`);
  } finally {
    if (input) { input.length = 0; input = null; }
    if (hashesMap) { hashesMap.clear(); hashesMap = null; }
    if (hashCache) { hashCache.clear(); hashCache = null; }
    if (dataWithLeaks) { dataWithLeaks.length = 0; dataWithLeaks = null; }
    // eslint-disable-next-line no-param-reassign
    config.exportPassword = undefined;
  }
}
