import { passwordObject, hashWithLeaksAndPasswordObjects } from '../interfaces/types';
import readCsvInputFile from './csv/input';
import writePreparedDataToCsv from './csv/output';
import readJsonInputFile from './json/input';
import writeJsonOutputFile from './json/output';

export type InputHandler = (
  path: string,
) => Promise<Array<passwordObject>>;
export type OutputHandler = (
  path: string,
  data: Array<hashWithLeaksAndPasswordObjects>,
) => Promise<void>;

export const inputHandlers: Record<string, InputHandler> = {
  csv: readCsvInputFile,
  json: readJsonInputFile,
};

export const outputHandlers: Record<string, OutputHandler> = {
  csv: writePreparedDataToCsv,
  json: writeJsonOutputFile,
};
