import hasha from 'hasha';
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

  if (!config.outputs.length) {
    throw new Error('At least one output must be configured in config.outputs');
  }

  const inputHandler = inputHandlers[config.inputFormat];
  if (!inputHandler) {
    throw new Error(`Unknown input format: ${config.inputFormat}`);
  }

  logger.log('Reading input file');
  const input = await inputHandler(config.inputPath);
  if (!input.length) {
    throw new Error('Not found correct not-empty passwords');
  }
  logger.log(`Found ${beautifullyPrintNumber(input.length)} correct not-empty passwords`);

  logger.log('Counting hashes for passwords');
  const inputWithHashes = await Promise.all(input.map(async (obj) => {
    const hash = (await hasha.async(obj.login_password, { algorithm: 'sha1' })).toUpperCase();
    return { hash, passwordObject: obj };
  }));
  logger.log('Hashes for passwords ready');

  logger.log('Converting array to map');
  const hashesMap = convertArrayWithHashesToMap(inputWithHashes);

  let numberOfLines: number | undefined;
  if (config.countLinesInHashesFile) {
    logger.log('Counting lines in hashes file before checking for leaks');
    numberOfLines = await countLinesInHashesFile(config.hashesOfLeaksPath, logger);
    logger.log('Counted lines in hashes file');
  } else {
    logger.log('Skipped counting lines in hashes file');
  }

  logger.log('Checking hashes for leaks');
  const dataWithLeaks = await getDataWithLeaks(hashesMap, config.hashesOfLeaksPath, 'utf-8', logger, numberOfLines);
  logger.log('Checked hashes for leaks');

  logger.log('Sorting output by leaks DESC');
  const sortedDataWithLeaks = structuredClone(dataWithLeaks).sort((a, b) => {
    if (a.leaks > b.leaks) return -1;
    if (a.leaks < b.leaks) return 1;
    return 0;
  });
  logger.log('Sorted output');

  await Promise.all(config.outputs.map(async (output) => {
    const handler = outputHandlers[output.format];
    if (!handler) {
      throw new Error(`Unknown output format: ${output.format}`);
    }
    logger.log(`Writing ${output.format} output to ${output.path}`);
    await handler(output.path, sortedDataWithLeaks);
    logger.log(`Written ${output.format} output`);
  }));

  const endDate = new Date();
  logger.log(`Finished in ${timeDurationBetweenDatesInWords(startDate, endDate)}`);
};
