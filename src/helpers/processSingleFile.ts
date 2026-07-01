import fs, { PathLike } from 'fs';
import {
  passwordObject,
  hashWithLeaksAndPasswordObjects,
} from '../interfaces/types';
import beautifullyPrintNumber from './beautifullyPrintNumber';
import timeDurationBetweenDatesInWords from './timeDurationBetweenDatesInWords';
import estimatedTimeRemaining from './estimatedTimeRemaining';
import { HIGH_WATER_MARK } from '../constants';
import parseBuffer from './parseBuffer';
import buildFingerprintSet from './buildFingerprintSet';

const NEWLINE = 0x0A;

export default async function processSingleFile(
  hashesWithPasswordObjects: Map<string, Array<passwordObject>>,
  filePath: PathLike,
  encoding: BufferEncoding,
  logger?: (message: string) => void,
  numberOfLines?: number,
): Promise<Array<hashWithLeaksAndPasswordObjects>> {
  const fingerprintSet = buildFingerprintSet(
    Array.from(hashesWithPasswordObjects.keys()).map((h) => h.slice(0, 4)),
  );

  return new Promise((resolve, reject) => {
    let linesProcessed = 0;
    let matchedHashCount = 0;
    let cumulativeLeakCount = 0;
    let previousLineCount = 0;
    let lastProgressTime = new Date();
    const startTime = new Date();

    let progressInterval: ReturnType<typeof setInterval> | undefined;
    const logProgress = () => {
      if (!logger) return;
      const now = new Date();
      const elapsedSeconds = (now.getTime() - lastProgressTime.getTime()) / 1000;
      const linesPerSecond = elapsedSeconds === 0
        ? 0
        : Math.round((linesProcessed - previousLineCount) / elapsedSeconds);
      const percentage = numberOfLines === undefined
        ? ''
        : ` (${Math.floor((linesProcessed / numberOfLines) * 10000) / 100}%)`;
      const lineCountMsg = numberOfLines
        ? ` from ${beautifullyPrintNumber(numberOfLines)}${percentage}`
        : '';
      logger(
        `Already checked ${beautifullyPrintNumber(linesProcessed)}${lineCountMsg} lines in file with hashes`,
      );
      logger(`Reading ${beautifullyPrintNumber(linesPerSecond)} lines per second`);
      logger(`Checking passwords time: ${timeDurationBetweenDatesInWords(startTime, new Date())}`);
      if (numberOfLines !== undefined) {
        if (linesProcessed >= numberOfLines) {
          logger('Estimated time remaining: finishing up...');
        } else if (linesProcessed > 0 && elapsedSeconds > 0) {
          const elapsedMs = now.getTime() - startTime.getTime();
          const eta = estimatedTimeRemaining(linesProcessed, numberOfLines, elapsedMs);
          if (eta !== undefined) {
            logger(`Estimated time remaining: ${eta}`);
          }
        }
      }
      previousLineCount = linesProcessed;
      lastProgressTime = now;
    };

    if (logger) {
      progressInterval = setInterval(logProgress, 1000);
      logProgress();
    }

    const stream = fs.createReadStream(
      filePath,
      { encoding: null as never, highWaterMark: HIGH_WATER_MARK },
    );
    let partialLineBuffer: Buffer | null = null;
    const results: Array<hashWithLeaksAndPasswordObjects> = [];

    const fullHashMap = hashesWithPasswordObjects as Map<string, passwordObject[]>;

    stream.on('data', (chunk: string | Buffer) => {
      const buf = chunk as Buffer;

      let offset = 0;
      if (partialLineBuffer !== null) {
        const firstNewline = buf.indexOf(NEWLINE);
        if (firstNewline === -1) {
          partialLineBuffer = Buffer.concat([partialLineBuffer, buf]);
          return;
        }

        const completedLine = Buffer.concat([
          partialLineBuffer,
          buf.subarray(0, firstNewline),
        ]);
        try {
          const stats = parseBuffer(completedLine, '', fullHashMap, results, encoding, fingerprintSet);
          linesProcessed += stats.linesProcessed;
          matchedHashCount += stats.matchedHashCount;
          cumulativeLeakCount += stats.cumulativeLeakCount;
        } catch (err) {
          clearInterval(progressInterval);
          reject(err);
          return;
        }
        partialLineBuffer = null;
        offset = firstNewline + 1;
      }

      const remaining = offset > 0 ? buf.subarray(offset) : buf;
      const lastNewline = remaining.lastIndexOf(NEWLINE);

      if (lastNewline === -1) {
        partialLineBuffer = remaining;
        return;
      }

      const completeSection = remaining.subarray(0, lastNewline);
      try {
        const stats = parseBuffer(completeSection, '', fullHashMap, results, encoding, fingerprintSet);
        linesProcessed += stats.linesProcessed;
        matchedHashCount += stats.matchedHashCount;
        cumulativeLeakCount += stats.cumulativeLeakCount;
      } catch (err) {
        clearInterval(progressInterval);
        reject(err);
        return;
      }

      partialLineBuffer = remaining.subarray(lastNewline + 1);
    });

    stream.on('end', () => {
      if (partialLineBuffer !== null) {
        try {
          const stats = parseBuffer(partialLineBuffer, '', fullHashMap, results, encoding, fingerprintSet);
          linesProcessed += stats.linesProcessed;
          matchedHashCount += stats.matchedHashCount;
          cumulativeLeakCount += stats.cumulativeLeakCount;
        } catch (err) {
          clearInterval(progressInterval);
          reject(err);
          return;
        }
      }

      clearInterval(progressInterval);
      logProgress();
      if (logger) {
        const totalElapsed = (Date.now() - startTime.getTime()) / 1000;
        const avgLinesPerSecond = totalElapsed === 0
          ? 0
          : Math.round(linesProcessed / totalElapsed);
        logger(
          `Checked all ${beautifullyPrintNumber(linesProcessed)} lines. `
          + `Found ${beautifullyPrintNumber(matchedHashCount)} hashes `
          + `with total ${beautifullyPrintNumber(cumulativeLeakCount)} leaks`,
        );
        logger(`Reading ${beautifullyPrintNumber(avgLinesPerSecond)} avg lines per second`);
        logger(`Checked passwords in ${timeDurationBetweenDatesInWords(startTime, new Date())}`);
      }
      resolve(results);
    });

    stream.on('error', (err) => {
      clearInterval(progressInterval);
      reject(err);
    });
  });
}
