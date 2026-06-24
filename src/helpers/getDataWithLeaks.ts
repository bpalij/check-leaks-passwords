import fs, { PathLike } from 'fs';
import readline from 'readline';
import {
  passwordObject,
  hashWithLeaksAndPasswordObjects,
} from '../interfaces/types';
import beautifullyPrintNumber from './beautifullyPrintNumber';
import deepCopy from './deepCopy';

export default (
  hashesWithPasswordObjects: Map<string, Array<passwordObject>>,
  path: PathLike,
  encoding: BufferEncoding,
  numberOfLines?: number,
  logger?: Console,
): Promise<Array<hashWithLeaksAndPasswordObjects>> => new Promise((resolve, reject) => {
  let lines = 0;
  let previousLines = 0;
  let leakedHashes = 0;
  let totalLeaks = 0;
  let outputArr: Array<hashWithLeaksAndPasswordObjects> = [];
  const fileStream = fs.createReadStream(path, { encoding });
  const rl = readline.createInterface(fileStream);

  let previousDate: Date = new Date();
  const interval = setInterval(() => {
    if (!logger) return;
    const currentDate = new Date();
    logger.log(`Already checked ${beautifullyPrintNumber(lines)}${numberOfLines === undefined ? ' ' : ` from ${beautifullyPrintNumber(numberOfLines)} `}lines in file with hashes`);
    logger.log(`Reading ${beautifullyPrintNumber(Math.round((lines - previousLines) / ((currentDate.getTime() - previousDate.getTime()) / 1000)))} lines in one second`);
    previousLines = lines;
    previousDate = currentDate;
  }, 1000);

  rl.on('line', (line) => {
    if (!/^[0-9A-F]{40,40}:[0-9]+$/.test(line)) {
      clearInterval(interval);
      reject(new Error(`Line ${lines} in hashes file is incorrect! It must be like "uppercase sha1 hash":"number of leaks"`));
    }
    const [hash, leaks] = line.split(':');
    if (hashesWithPasswordObjects.has(hash)) {
      const passwordObjects = hashesWithPasswordObjects.get(hash);
      if (passwordObjects) {
        const objForAdd: hashWithLeaksAndPasswordObjects = {
          hash,
          leaks: +leaks,
          readableLeaks: beautifullyPrintNumber(+leaks),
          passwordObjects: deepCopy(passwordObjects),
        };
        outputArr = [...deepCopy(outputArr), objForAdd];
        leakedHashes += 1;
        totalLeaks += +leaks;
      }
    }
    lines += 1;
  });

  rl.on('close', () => {
    clearInterval(interval);
    if (logger) {
      logger.log(`Checked all ${beautifullyPrintNumber(lines)} lines. Found ${beautifullyPrintNumber(leakedHashes)} hashes with total ${beautifullyPrintNumber(totalLeaks)} leaks`);
    }
    resolve(outputArr);
  });
});
