import crypto from 'crypto';
import { type configInterface } from '../config/configInterface';
import { inputHandlers, outputHandlers } from './handlers/index';
import beautifullyPrintNumber from './helpers/beautifullyPrintNumber';
import convertArrayWithHashesToMap from './helpers/convertArrayWithHashesToMap';
import getDataWithLeaks from './helpers/getDataWithLeaks';
import countLinesInHashesFile from './helpers/countLinesInHashesFile';
import timeDurationBetweenDatesInWords from './helpers/timeDurationBetweenDatesInWords';

export default async (
  config: Readonly<configInterface>,
  logger: Console = console,
): Promise<void> => {
  const startDate = new Date();

  const timedLog = (message: string) => {
    logger.log(`${message}  [${timeDurationBetweenDatesInWords(startDate, new Date())}]`);
  };

  if (!config.outputs.length) {
    throw new Error('At least one output must be configured in config.outputs');
  }

  const inputHandler = inputHandlers[config.inputFormat];
  if (!inputHandler) {
    throw new Error(`Unknown input format: ${config.inputFormat}`);
  }

  timedLog('Reading input file');
  const input = await inputHandler(config.inputPath);
  if (!input.length) {
    throw new Error('Not found correct not-empty passwords');
  }
  timedLog(`Found ${beautifullyPrintNumber(input.length)} correct not-empty passwords`);

  timedLog('Counting hashes for passwords');
  const inputWithHashes = await Promise.all(input.map(async (obj) => {
    const hash = crypto.createHash('sha1').update(obj.login_password).digest('hex').toUpperCase();
    return { hash, passwordObject: obj };
  }));
  timedLog('Hashes for passwords ready');

  timedLog('Converting array to map');
  const hashesMap = convertArrayWithHashesToMap(inputWithHashes);

  let numberOfLines: number | undefined;
  if (config.countLinesInHashesFile) {
    timedLog('Counting lines in hashes file before checking for leaks');
    numberOfLines = await countLinesInHashesFile(config.hashesOfLeaksPath, timedLog);
    timedLog('Counted lines in hashes file');
  } else {
    timedLog('Skipped counting lines in hashes file');
  }

  timedLog('Checking hashes for leaks');
  const dataWithLeaks = await getDataWithLeaks(hashesMap, config.hashesOfLeaksPath, 'ascii', timedLog, numberOfLines);
  timedLog('Checked hashes for leaks');

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
