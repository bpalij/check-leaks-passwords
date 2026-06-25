import fs, { PathLike } from 'fs';
import beautifullyPrintNumber from './beautifullyPrintNumber';
import { HIGH_WATER_MARK } from '../constants';

const NEWLINE = 10;

export default (
  path: PathLike,
  logger?: Console,
): Promise<number> => new Promise((resolve, reject) => {
  let lines = 0;
  let previousLines = 0;
  let previousDate = new Date();

  const logProgress = () => {
    if (!logger) return;
    const now = new Date();
    const elapsedSec = (now.getTime() - previousDate.getTime()) / 1000;
    const linesPerSec = elapsedSec === 0 ? 0 : Math.round((lines - previousLines) / elapsedSec);
    logger.log(`Counted ${beautifullyPrintNumber(lines)} lines in hashes file`);
    logger.log(`Counting ${beautifullyPrintNumber(linesPerSec)} lines per second`);
    previousLines = lines;
    previousDate = now;
  };

  const interval = setInterval(logProgress, 1000);
  logProgress();

  const stream = fs.createReadStream(path, { highWaterMark: HIGH_WATER_MARK });

  stream.on('data', (chunk: string | Buffer) => {
    if (typeof chunk === 'string') return;
    for (let i = 0; i < chunk.length; i += 1) {
      if (chunk[i] === NEWLINE) lines += 1;
    }
  });

  stream.on('end', () => {
    clearInterval(interval);
    logProgress();
    if (logger) logger.log(`Counted all ${beautifullyPrintNumber(lines)} lines in hashes file`);
    resolve(lines);
  });

  stream.on('error', (err) => {
    clearInterval(interval);
    reject(err);
  });
});
