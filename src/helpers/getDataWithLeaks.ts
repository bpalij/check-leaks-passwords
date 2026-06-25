import fs, { PathLike } from 'fs';
import readline from 'readline';
import {
  passwordObject,
  hashWithLeaksAndPasswordObjects,
} from '../interfaces/types';
import beautifullyPrintNumber from './beautifullyPrintNumber';
import { HIGH_WATER_MARK } from '../constants';

const HASH_LINE_REGEX = /^[0-9A-F]{40}:[0-9]+$/;

export default (
  hashesWithPasswordObjects: Map<string, Array<passwordObject>>,
  path: PathLike,
  encoding: BufferEncoding,
  logger?: Console,
  numberOfLines?: number,
): Promise<Array<hashWithLeaksAndPasswordObjects>> => new Promise((resolve, reject) => {
  let lines = 0;
  let previousLines = 0;
  let leakedHashes = 0;
  let totalLeaks = 0;
  const outputArr: Array<hashWithLeaksAndPasswordObjects> = [];
  const fileStream = fs.createReadStream(path, { encoding, highWaterMark: HIGH_WATER_MARK });
  const rl = readline.createInterface(fileStream);

  let previousDate: Date = new Date();
  const logProgress = () => {
    if (!logger) return;
    const now = new Date();
    const elapsedSec = (now.getTime() - previousDate.getTime()) / 1000;
    const linesPerSec = elapsedSec === 0 ? 0 : Math.round((lines - previousLines) / elapsedSec);
    const percentage = numberOfLines === undefined
      ? undefined
      : Math.floor((lines / numberOfLines) * 100 * 100) / 100;
    const lineCountMsg = numberOfLines === undefined
      ? `Already checked ${beautifullyPrintNumber(lines)}`
      : `Already checked ${beautifullyPrintNumber(lines)} from ${beautifullyPrintNumber(numberOfLines)} (${percentage}%)`;
    logger.log(`${lineCountMsg} lines in file with hashes`);
    logger.log(`Reading ${beautifullyPrintNumber(linesPerSec)} lines per second`);
    previousLines = lines;
    previousDate = now;
  };

  const interval = setInterval(logProgress, 1000);
  logProgress();

  rl.on('error', (err) => {
    clearInterval(interval);
    reject(err);
  });

  rl.on('line', (line) => {
    if (!HASH_LINE_REGEX.test(line)) {
      clearInterval(interval);
      reject(new Error(`Line ${lines} in hashes file is incorrect! It must be like "uppercase sha1 hash":"number of leaks"`));
    }
    const [hash, leaks] = line.split(':');
    const passwordObjects = hashesWithPasswordObjects.get(hash);
    if (passwordObjects) {
      const leakCount = +leaks;
      const objForAdd: hashWithLeaksAndPasswordObjects = {
        hash,
        leaks: leakCount,
        readableLeaks: beautifullyPrintNumber(leakCount),
        passwordObjects: structuredClone(passwordObjects),
      };
      outputArr.push(objForAdd);
      leakedHashes += 1;
      totalLeaks += leakCount;
    }
    lines += 1;
  });

  rl.on('close', () => {
    clearInterval(interval);
    logProgress();
    if (logger) {
      logger.log(`Checked all ${beautifullyPrintNumber(lines)} lines. Found ${beautifullyPrintNumber(leakedHashes)} hashes with total ${beautifullyPrintNumber(totalLeaks)} leaks`);
    }
    resolve(outputArr);
  });
});
