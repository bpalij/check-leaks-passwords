import { PasswordObject, HashWithLeaksAndPasswordObjects, OutputHandlerOptions } from '../types.js';
import { readCsvInputFile } from './csv/read.js';
import { writePreparedDataToCsv } from './csv/write.js';
import { readJsonInputFile } from './json/read.js';
import { writeJsonOutputFile } from './json/write.js';

/**
 * Input handler function type.
 *
 * Reads a Bitwarden export file and returns an array of password objects.
 *
 * @param path - Path to the input file.
 * @param password - Optional export password for encrypted files.
 * @param onReadComplete - Callback invoked when file reading is complete.
 * @returns Array of password objects parsed from the file.
 */
export type InputHandler = (
  path: string,
  password?: string,
  onReadComplete?: () => void,
) => Promise<Array<PasswordObject>>;

export type { OutputHandlerOptions };

/**
 * Output handler function type.
 *
 * Writes enriched leak results to a file in the specified format.
 *
 * @param path - Path to the output file.
 * @param data - Enriched results with leak counts and password objects.
 * @param options - Output options (e.g., includeSecrets).
 */
export type OutputHandler = (
  path: string,
  data: Array<HashWithLeaksAndPasswordObjects>,
  options?: OutputHandlerOptions,
) => Promise<void>;

/** Registry of input handlers keyed by format name. */
export const inputHandlers: Record<string, InputHandler> = {
  csv: readCsvInputFile,
  json: readJsonInputFile,
};

/** Registry of output handlers keyed by format name. */
export const outputHandlers: Record<string, OutputHandler> = {
  csv: writePreparedDataToCsv,
  json: writeJsonOutputFile,
};
