import { parseFile } from 'fast-csv';
import { passwordObject } from '../../interfaces/types';

const validateSinglePasswordObject = (x: unknown): boolean => {
  if (x && typeof x === 'object' && typeof (x as Record<string, unknown>).login_password === 'string') {
    const keys = Object.keys(x);
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (typeof key !== 'string') {
        return false;
      }
      const val = (x as Record<string, unknown>)[key];
      if ((typeof val !== 'string' && typeof val !== 'number' && val !== undefined) || val === null) {
        return false;
      }
    }
    return true;
  }
  return false;
};

const readCsvInputFile = (path: string): Promise<Array<passwordObject>> => (
  new Promise((resolve, reject) => {
    const result: Array<passwordObject> = [];
    parseFile(path, { headers: true })
      .on('error', (error) => { reject(error); })
      .on('data', (row) => {
        if (!validateSinglePasswordObject(row)) {
          reject(new Error('one of rows is not valid!'));
        }
        result.push(row as passwordObject);
      })
      .on('end', () => {
        resolve(result.filter((row) => row.login_password));
      });
  })
);

export default readCsvInputFile;
