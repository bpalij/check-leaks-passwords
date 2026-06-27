import fs, { PathLike } from 'fs';
import beautifullyPrintNumber from './beautifullyPrintNumber';
import timeDurationBetweenDatesInWords from './timeDurationBetweenDatesInWords';
import { HIGH_WATER_MARK } from '../constants';

const NEWLINE = 10;

export default (
  path: PathLike,
  logger?: (message: string) => void,
): Promise<number | undefined> => {
  try {
    if (fs.statSync(path).isDirectory()) {
      if (logger) logger('Skipped line counting for split hash directory');
      return Promise.resolve(undefined);
    }
  } catch (err) {
    return Promise.reject(err);
  }
  return new Promise((resolve, reject) => {
    let lines = 0;
    let previousLines = 0;
    let previousDate = new Date();
    const startTime = new Date();

    const logProgress = () => {
      if (!logger) return;
      const now = new Date();
      const elapsedSec = (now.getTime() - previousDate.getTime()) / 1000;
      const linesPerSec = elapsedSec === 0 ? 0 : Math.round((lines - previousLines) / elapsedSec);
      logger(`Counted ${beautifullyPrintNumber(lines)} lines in hashes file`);
      logger(`Counting ${beautifullyPrintNumber(linesPerSec)} lines per second`);
      logger(`Counting lines time: ${timeDurationBetweenDatesInWords(startTime, new Date())}`);
      previousLines = lines;
      previousDate = now;
    };

    const interval = setInterval(logProgress, 1000);
    logProgress();

    const stream = fs.createReadStream(
      path,
      { encoding: null as never, highWaterMark: HIGH_WATER_MARK },
    );

    stream.on('data', (chunk: string | Buffer) => {
      const buf = chunk as Buffer;

      let searchOffset = buf.indexOf(NEWLINE, 0);
      while (searchOffset !== -1) {
        lines += 1;
        searchOffset = buf.indexOf(NEWLINE, searchOffset + 1);
      }
    });

    stream.on('end', () => {
      clearInterval(interval);
      logProgress();
      const totalElapsed = (Date.now() - startTime.getTime()) / 1000;
      const avgLinesPerSecond = totalElapsed === 0
        ? 0
        : Math.round(lines / totalElapsed);
      if (logger) {
        logger(`Counted all ${beautifullyPrintNumber(lines)} lines in hashes file`);
        logger(`Counting ${beautifullyPrintNumber(avgLinesPerSecond)} avg lines per second`);
        logger(`Counted lines in ${timeDurationBetweenDatesInWords(startTime, new Date())}`);
      }
      resolve(lines);
    });

    stream.on('error', (err) => {
      clearInterval(interval);
      reject(err);
    });
  });
};
