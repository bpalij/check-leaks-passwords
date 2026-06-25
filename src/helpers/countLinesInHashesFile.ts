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

  const stream = fs.createReadStream(
    path,
    { encoding: null as never, highWaterMark: HIGH_WATER_MARK },
  );

  stream.on('data', (chunk: string | Buffer) => {
    const buf = chunk as Buffer;

    // Buffer.indexOf(NEWLINE, offset) uses native C memchr with SIMD
    // to find the next \n byte — ~3-5x faster than a JS for-loop.
    //
    // Step 1: find the first NEWLINE position
    // Step 2: if not found (-1), exit the loop
    // Step 3: if found, increment the counter
    // Step 4: search again starting just past found position
    // Step 5: repeat until no more newlines in this chunk
    let searchOffset = buf.indexOf(NEWLINE, 0);
    while (searchOffset !== -1) {
      lines += 1;
      searchOffset = buf.indexOf(NEWLINE, searchOffset + 1);
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
