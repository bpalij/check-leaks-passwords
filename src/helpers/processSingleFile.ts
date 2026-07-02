import fs, { PathLike } from 'fs';
import {
  passwordObject,
  hashWithLeaksAndPasswordObjects,
} from '../interfaces/types';
import beautifullyPrintNumber from './beautifullyPrintNumber';
import beautifullyPrintBytes from './beautifullyPrintBytes';
import beautifullyPrintCompact from './beautifullyPrintCompact';
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
): Promise<Array<hashWithLeaksAndPasswordObjects>> {
  const fingerprintSet = buildFingerprintSet(
    Array.from(hashesWithPasswordObjects.keys()).map((h) => h.slice(0, 4)),
  );

  const { size: fileSize } = await fs.promises.stat(filePath as string);

  return new Promise((resolve, reject) => {
    let bytesProcessed = 0;
    let linesProcessed = 0;
    let matchedHashCount = 0;
    let cumulativeLeakCount = 0;
    let previousBytes = 0;
    let previousLines = 0;
    let lastProgressTime = new Date();
    const startTime = new Date();
    let avgBytesPerLine = 0;

    let progressInterval: ReturnType<typeof setInterval> | undefined;
    const logProgress = () => {
      if (!logger) return;
      const now = new Date();
      const elapsedSeconds = (now.getTime() - lastProgressTime.getTime()) / 1000;
      const bytesPerSec = elapsedSeconds === 0
        ? 0
        : Math.round((bytesProcessed - previousBytes) / elapsedSeconds);
      const linesPerSec = elapsedSeconds === 0
        ? 0
        : Math.round((linesProcessed - previousLines) / elapsedSeconds);
      const percentage = ` (${Math.floor((bytesProcessed / fileSize) * 10000) / 100}%)`;
      logger(
        `Already checked ${beautifullyPrintBytes(bytesProcessed)} from ${beautifullyPrintBytes(fileSize)}${percentage}`,
      );
      if (linesProcessed > 0 && avgBytesPerLine > 0) {
        const estimatedTotalLines = Math.floor(fileSize / avgBytesPerLine);
        logger(
          `Checked ${beautifullyPrintCompact(linesProcessed)} of ~${beautifullyPrintCompact(estimatedTotalLines)} lines`,
        );
      } else {
        logger(`Checked ${beautifullyPrintCompact(linesProcessed)} lines`);
      }
      if (bytesPerSec > 0) {
        const lineRate = linesPerSec > 0
          ? ` (${beautifullyPrintCompact(linesPerSec)} lines/s)`
          : '';
        logger(`Reading ${beautifullyPrintBytes(bytesPerSec)}/s${lineRate}`);
      }
      logger(`Checking passwords time: ${timeDurationBetweenDatesInWords(startTime, new Date())}`);
      if (bytesProcessed >= fileSize || bytesProcessed <= 0 || elapsedSeconds <= 0) {
        if (bytesProcessed >= fileSize) {
          logger('Estimated time remaining: finishing up...');
        }
      } else {
        const elapsedMs = now.getTime() - startTime.getTime();
        const eta = estimatedTimeRemaining(bytesProcessed, fileSize, elapsedMs);
        if (eta !== undefined) {
          logger(`Estimated time remaining: ${eta}`);
        }
      }
      previousBytes = bytesProcessed;
      previousLines = linesProcessed;
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
      bytesProcessed += buf.length;

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

      if (linesProcessed > 1000 && avgBytesPerLine === 0) {
        avgBytesPerLine = bytesProcessed / linesProcessed;
      }
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
        const avgBytesPerSec = totalElapsed === 0
          ? 0
          : Math.round(bytesProcessed / totalElapsed);
        const avgLinesPerSec = totalElapsed === 0
          ? 0
          : Math.round(linesProcessed / totalElapsed);
        logger(
          `Checked all ${beautifullyPrintBytes(bytesProcessed)} (${beautifullyPrintNumber(linesProcessed)} / ${beautifullyPrintCompact(linesProcessed)} lines)`,
        );
        logger(
          `Found ${beautifullyPrintNumber(matchedHashCount)} hashes with total ${beautifullyPrintNumber(cumulativeLeakCount)} (${beautifullyPrintCompact(cumulativeLeakCount)}) leaks`,
        );
        logger(`Reading ${beautifullyPrintBytes(avgBytesPerSec)}/s avg (${beautifullyPrintCompact(avgLinesPerSec)} lines/s avg)`);
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
