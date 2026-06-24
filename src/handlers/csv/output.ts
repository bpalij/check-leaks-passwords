import { writeToPath } from 'fast-csv';
import { hashWithLeaksAndPasswordObjects } from '../../interfaces/types';

function sanitizeRow(row: Record<string, unknown>): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  Object.keys(row).forEach((key) => {
    const val = row[key];
    if (val === undefined) {
      result[key] = undefined;
    } else if (typeof val === 'string') {
      result[key] = val;
    } else {
      result[key] = JSON.stringify(val);
    }
  });
  return result;
}

const writePreparedDataToCsv = (
  path: string,
  data: Array<hashWithLeaksAndPasswordObjects>,
): Promise<void> => {
  const flattenedData: Array<Record<string, string | undefined>> = data
    .map((val) => {
      const {
        hash, leaks, readableLeaks, passwordObjects,
      } = val;
      return passwordObjects.map((obj) => sanitizeRow(
        {
          ...obj,
          login_password_hash: hash,
          login_password_leaks: `${leaks}`,
          login_password_readable_leaks: readableLeaks,
        },
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
