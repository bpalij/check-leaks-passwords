import fs from 'fs';

import {
  PasswordObject, HashWithLeaksAndPasswordObjects, OnProgress, SingleFileReadMode,
} from '../types.js';
import { processSingleFile } from './processSingleFile.js';
import { processSplitDirectory } from './processSplitDirectory.js';

/**
 * Dispatch HIBP data processing to the appropriate handler.
 *
 * If `hashesPath` is a directory, uses split-directory processing (one file
 * per 5-character prefix). If it's a file, uses single-file processing with
 * automatic read mode selection.
 *
 * @param hashesWithPasswordObjects - Map from SHA-1 hex hash to password objects.
 * @param hashesPath - Path to HIBP hashes file or split-prefix directory.
 * @param encoding - Buffer encoding for hash comparison.
 * @param logger - Optional logging callback.
 * @param onProgress - Optional progress callback.
 * @param singleFileReadMode - Read mode override for single-file processing.
 * @param buildIndex - Whether to build a `.idx` file during processing.
 * @param fullHashLength - Length of a full hex hash (40 for SHA-1, 32 for NTLM).
 *   Defaults to 40 (SHA-1).
 * @returns Enriched results with leak counts and password objects.
 *
 * @security Handles password hash maps derived from passwords — treat as sensitive.
 */
export async function processDataLeaks(
  hashesWithPasswordObjects: Map<string, Array<PasswordObject>>,
  hashesPath: string,
  encoding: BufferEncoding,
  logger?: (message: string) => void,
  onProgress?: OnProgress,
  singleFileReadMode?: SingleFileReadMode,
  buildIndex?: boolean,
  fullHashLength?: number,
): Promise<Array<HashWithLeaksAndPasswordObjects>> {
  const stat = await fs.promises.stat(hashesPath);
  if (stat.isDirectory()) {
    return processSplitDirectory(
      hashesWithPasswordObjects,
      hashesPath,
      encoding,
      logger,
      onProgress,
      fullHashLength,
    );
  }
  return processSingleFile(
    hashesWithPasswordObjects,
    hashesPath,
    encoding,
    logger,
    undefined,
    onProgress,
    singleFileReadMode,
    buildIndex,
    fullHashLength,
  );
}
