import { writeToPath } from 'fast-csv';
import {
  hashWithLeaksAndPasswordObjects,
  passwordObjectWithInjectedHashAndLeaks,
} from '../../interfaces/types';

const writePreparedDataToCsv = (
  path: string,
  data: Array<hashWithLeaksAndPasswordObjects>,
): Promise<void> => {
  const flattenedData: Array<passwordObjectWithInjectedHashAndLeaks> = data
    .map((val) => {
      const {
        hash, leaks, readableLeaks, passwordObjects,
      } = val;
      return passwordObjects.map((obj) => (
        {
          ...obj,
          login_password_hash: hash,
          login_password_leaks: `${leaks}`,
          login_password_readable_leaks: readableLeaks,
        }
      ));
    })
    .reduce((acc, val) => [...acc, ...val], []);

  return new Promise((resolve, reject) => {
    writeToPath(path, flattenedData, { headers: true })
      .on('error', (err) => { reject(err); })
      .on('finish', () => { resolve(); });
  });
};

export default writePreparedDataToCsv;
