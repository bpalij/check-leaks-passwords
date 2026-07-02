import crypto from 'crypto';
import { type configInterface } from '../config/configInterface';
import validateConfig from '../config/validateConfig';
import { inputHandlers, outputHandlers } from './handlers/index';
import beautifullyPrintNumber from './helpers/beautifullyPrintNumber';
import convertArrayWithHashesToMap from './helpers/convertArrayWithHashesToMap';
import extractPassword from './helpers/extractPassword';
import getDataWithLeaks from './helpers/getDataWithLeaks';
import timeDurationBetweenDatesInWords from './helpers/timeDurationBetweenDatesInWords';
import processHibpApi from './helpers/processHibpApi';

export default async (
  config: Readonly<configInterface>,
  logger: Console = console,
): Promise<void> => {
  validateConfig(config);

  const startDate = new Date();

  const timedLog = (message: string) => {
    logger.log(`${message}  [${timeDurationBetweenDatesInWords(startDate, new Date())}]`);
  };

  timedLog('Reading input file');
  const inputHandler = inputHandlers[config.inputFormat];
  const input = await inputHandler(config.inputPath);
  if (!input.length) {
    throw new Error('Not found correct not-empty passwords');
  }
  timedLog(`Found ${beautifullyPrintNumber(input.length)} correct not-empty passwords`);

  timedLog('Counting hashes for passwords');
  const inputWithHashes = await Promise.all(input.map(async (obj) => {
    const hash = crypto.createHash('sha1').update(extractPassword(obj)).digest('hex').toUpperCase();
    return { hash, passwordObject: obj };
  }));
  timedLog('Hashes for passwords ready');

  timedLog('Converting array to map');
  const hashesMap = convertArrayWithHashesToMap(inputWithHashes);

  let dataWithLeaks;
  if (config.useHibpApi) {
    timedLog('Checking hashes for leaks via HIBP API');
    dataWithLeaks = await processHibpApi(hashesMap, timedLog);
    timedLog('Checked hashes for leaks');
  } else {
    timedLog('Checking hashes for leaks');
    dataWithLeaks = await getDataWithLeaks(hashesMap, config.hashesOfLeaksPath, 'ascii', timedLog);
    timedLog('Checked hashes for leaks');
  }

  timedLog('Sorting output by leaks DESC');
  const sortedDataWithLeaks = structuredClone(dataWithLeaks).sort((a, b) => {
    if (a.leaks > b.leaks) return -1;
    if (a.leaks < b.leaks) return 1;
    return 0;
  });
  timedLog('Sorted output');

  await Promise.all(config.outputs.map(async (output) => {
    const handler = outputHandlers[output.format];
    if (!handler) {
      throw new Error(`Unknown output format: ${output.format}`);
    }
    timedLog(`Writing ${output.format} output to ${output.path}`);
    await handler(output.path, sortedDataWithLeaks);
    timedLog(`Written ${output.format} output`);
  }));

  const endDate = new Date();
  logger.log(`Finished in ${timeDurationBetweenDatesInWords(startDate, endDate)}`);
};
