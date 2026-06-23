import hasha from 'hasha';
import config from '../config/config';
import { inputHandlers, outputHandlers } from './handlers/index';
import beautifullyPrintNumber from './helpers/beautifullyPrintNumber';
import convertArrayWithHashesToMap from './helpers/convertArrayWithHashesToMap';
import getDataWithLeaks from './helpers/getDataWithLeaks';
import deepCopy from './helpers/deepCopy';
import timeDurationBetweenDatesInWords from './helpers/timeDurationBetweenDatesInWords';

export default async (): Promise<void> => {
  const startDate = new Date();

  const inputHandler = inputHandlers[config.inputFormat];
  if (!inputHandler) {
    throw new Error(`Unknown input format: ${config.inputFormat}`);
  }
  const outputHandler = outputHandlers[config.outputFormat];
  if (!outputHandler) {
    throw new Error(`Unknown output format: ${config.outputFormat}`);
  }

  console.log('Reading input file');
  const input = await inputHandler(config.inputPath);
  if (!input.length) {
    throw new Error('Not found correct not-empty passwords');
  }
  console.log(`Found ${beautifullyPrintNumber(input.length)} correct not-empty passwords`);

  console.log('Counting hashes for passwords');
  const inputWithHashes = await Promise.all(input.map(async (obj) => {
    const hash = (await hasha.async(obj.login_password, { algorithm: 'sha1' })).toUpperCase();
    return { hash, passwordObject: obj };
  }));
  console.log('Hashes for passwords ready');

  console.log('Converting array to map');
  const hashesMap = convertArrayWithHashesToMap(inputWithHashes);

  console.log('Checking hashes for leaks');
  const dataWithLeaks = await getDataWithLeaks(hashesMap, config.hashesOfLeaksPath, 'utf-8');
  console.log('Checked hashes for leaks');

  console.log('Sorting output by leaks DESC');
  const sortedDataWithLeaks = deepCopy(dataWithLeaks).sort((a, b) => {
    if (a.leaks > b.leaks) return -1;
    if (a.leaks < b.leaks) return 1;
    return 0;
  });
  console.log('Sorted output');

  console.log('Writing output file');
  await outputHandler(config.outputPath, sortedDataWithLeaks);
  console.log('Written output file');

  const endDate = new Date();
  console.log(`Finished in ${timeDurationBetweenDatesInWords(startDate, endDate)}`);
};
