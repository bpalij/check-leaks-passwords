import fs, { PathLike } from 'fs';
import path from 'path';
import {
  passwordObject,
  hashWithLeaksAndPasswordObjects,
} from '../interfaces/types';
import {
  HASH_PREFIX_LENGTH,
  MAX_CONCURRENT_FILE_READERS,
} from '../constants';
import parseBuffer from './parseBuffer';
import beautifullyPrintNumber from './beautifullyPrintNumber';
import beautifullyPrintCompact from './beautifullyPrintCompact';
import timeDurationBetweenDatesInWords from './timeDurationBetweenDatesInWords';
import estimatedTimeRemaining from './estimatedTimeRemaining';
import groupHashesByPrefix from './groupHashesByPrefix';
import buildFingerprintSet from './buildFingerprintSet';

export default async function processSplitDirectory(
  hashesWithPasswordObjects: Map<string, Array<passwordObject>>,
  dirPath: PathLike,
  encoding: BufferEncoding,
  logger?: (message: string) => void,
): Promise<Array<hashWithLeaksAndPasswordObjects>> {
  const prefixToSuffixMap = groupHashesByPrefix(hashesWithPasswordObjects, HASH_PREFIX_LENGTH);

  const matchingPrefixes = Array.from(prefixToSuffixMap.keys());
  const totalPrefixes = matchingPrefixes.length;
  const results: Array<hashWithLeaksAndPasswordObjects> = [];
  if (totalPrefixes === 0) return results;

  const allSuffixes = Array.from(prefixToSuffixMap.values()).flatMap((m) => Array.from(m.keys()));
  const fingerprintSet = buildFingerprintSet(allSuffixes);

  let nextPrefixIndex = 0;
  let processedPrefixCount = 0;
  let totalMatchedHashCount = 0;
  let totalCumulativeLeakCount = 0;
  const startTime = new Date();
  let lastLogTime = startTime;
  let lastProcessedCount = 0;

  let progressInterval: ReturnType<typeof setInterval> | undefined;
  const logProgress = () => {
    if (!logger) return;
    const now = new Date();
    const elapsedSeconds = (now.getTime() - lastLogTime.getTime()) / 1000;
    const filesPerSecond = elapsedSeconds === 0
      ? 0
      : Math.round((processedPrefixCount - lastProcessedCount) / elapsedSeconds);
    const percentage = ` (${Math.floor((processedPrefixCount / totalPrefixes) * 100 * 100) / 100}%)`;
    logger(
      `Already checked ${beautifullyPrintNumber(processedPrefixCount)}`
      + ` from ${beautifullyPrintNumber(totalPrefixes)}${percentage} prefix files`,
    );
    logger(`Reading ${beautifullyPrintNumber(filesPerSecond)} files per second`);
    logger(`Checking passwords time: ${timeDurationBetweenDatesInWords(startTime, new Date())}`);
    if (processedPrefixCount >= totalPrefixes) {
      logger('Estimated time remaining: finishing up...');
    } else if (processedPrefixCount > 0 && elapsedSeconds > 0) {
      const elapsedMs = now.getTime() - startTime.getTime();
      const eta = estimatedTimeRemaining(processedPrefixCount, totalPrefixes, elapsedMs);
      if (eta !== undefined) {
        logger(`Estimated time remaining: ${eta}`);
      }
    }
    lastProcessedCount = processedPrefixCount;
    lastLogTime = now;
  };

  if (logger) {
    progressInterval = setInterval(logProgress, 1000);
    logProgress();
  }

  const processNextPrefix = (): Promise<void> => {
    const currentIndex = nextPrefixIndex;
    nextPrefixIndex += 1;
    if (currentIndex >= totalPrefixes) return Promise.resolve();

    const prefix = matchingPrefixes[currentIndex];
    const prefixFilePath = path.join(dirPath as string, `${prefix}.txt`);
    const suffixLookupMap = prefixToSuffixMap.get(prefix);
    if (!suffixLookupMap) {
      throw new Error(`Invariant: prefix "${prefix}" not found in prefixToSuffixMap`);
    }

    const readPromise = fs.promises.readFile(prefixFilePath)
      .then((fileContent: Buffer) => {
        const stats = parseBuffer(
          fileContent, prefix, suffixLookupMap, results, encoding, fingerprintSet,
        );
        totalMatchedHashCount += stats.matchedHashCount;
        totalCumulativeLeakCount += stats.cumulativeLeakCount;
      })
      .catch((err: unknown) => {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      });

    return readPromise.then(() => {
      processedPrefixCount += 1;
      return processNextPrefix();
    });
  };

  const activeWorkerCount = Math.min(MAX_CONCURRENT_FILE_READERS, totalPrefixes);
  const workerPromises = Array.from(
    { length: activeWorkerCount },
    () => processNextPrefix(),
  );

  try {
    await Promise.all(workerPromises);
  } finally {
    clearInterval(progressInterval);
  }

  logProgress();
  if (logger) {
    const totalElapsed = (Date.now() - startTime.getTime()) / 1000;
    const avgFilesPerSecond = totalElapsed === 0
      ? 0
      : Math.round(totalPrefixes / totalElapsed);
    logger(
      `Checked all ${beautifullyPrintNumber(totalPrefixes)} prefix files.`
      + ` Found ${beautifullyPrintNumber(totalMatchedHashCount)} hashes`
      + ` with total ${beautifullyPrintNumber(totalCumulativeLeakCount)} (${beautifullyPrintCompact(totalCumulativeLeakCount)}) leaks`,
    );
    logger(`Reading ${beautifullyPrintNumber(avgFilesPerSecond)} files per second`);
    logger(`Checked passwords in ${timeDurationBetweenDatesInWords(startTime, new Date())}`);
  }

  return results;
}
