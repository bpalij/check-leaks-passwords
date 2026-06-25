import fs, { PathLike } from 'fs';
import beautifullyPrintNumber from './beautifullyPrintNumber';

const NEWLINE = 10;
const HIGH_WATER_MARK = 4 * 1024 * 1024;

export default (
  path: PathLike,
  logger?: Console,
): Promise<number> => new Promise((resolve, reject) => {
  let lines = 0;
  let previousLines = 0;
  let previousDate = new Date();

  const interval = setInterval(() => {
    if (!logger) return;
    const now = new Date();
    const elapsedSec = (now.getTime() - previousDate.getTime()) / 1000;
    const linesPerSec = Math.round((lines - previousLines) / elapsedSec);
    logger.log(`Counted ${beautifullyPrintNumber(lines)} lines in hashes file`);
    logger.log(`Counting ${beautifullyPrintNumber(linesPerSec)} lines per second`);
    previousLines = lines;
    previousDate = now;
  }, 1000);

  const stream = fs.createReadStream(path, { highWaterMark: HIGH_WATER_MARK });

  stream.on('data', (chunk: string | Buffer) => {
    if (typeof chunk === 'string') return;
    for (let i = 0; i < chunk.length; i += 1) {
      if (chunk[i] === NEWLINE) lines += 1;
    }
  });

  stream.on('end', () => {
    clearInterval(interval);
    if (logger) logger.log(`Counted all ${beautifullyPrintNumber(lines)} lines in hashes file`);
    resolve(lines);
  });

  stream.on('error', (err) => {
    clearInterval(interval);
    reject(err);
  });
});
