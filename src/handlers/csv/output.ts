import { writeToPath } from 'fast-csv';
import { hashWithLeaksAndPasswordObjects } from '../../interfaces/types';

const COLUMNS_ORDER = [
  'name',
  'folderName',
  'typeLabel',
  'type',
  'login_uris',
  'login_username',
  'login_password',
  'login_password_hash',
  'login_password_leaks',
  'login_password_readable_leaks',
  'login_password_compact_leaks',
  'login_totp',
  'hasTotp',
  'uriCount',
  'passwordAgeDays',
  'reprompt',
  'repromptLabel',
  'notes',
  'organizationId',
  'deletedDate',
];

function flattenNestedRow(row: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};

  if ('login' in row && row.login) {
    const login = row.login as Record<string, unknown>;

    Object.entries(row).forEach(([key, val]) => {
      if (key === 'login' || val == null || val === '' || (Array.isArray(val) && val.length === 0)) return;
      if (typeof val === 'string') {
        result[key] = val;
      } else if (typeof val === 'number' || typeof val === 'boolean') {
        result[key] = String(val);
      } else {
        result[key] = JSON.stringify(val);
      }
    });

    Object.entries(login).forEach(([key, val]) => {
      if (key === 'login_uris' || val == null || (Array.isArray(val) && val.length === 0)) return;
      const col = `login_${key}`;
      if (typeof val === 'string') {
        result[col] = val;
      } else if (typeof val === 'number' || typeof val === 'boolean') {
        result[col] = String(val);
      } else if (Array.isArray(val) && key === 'uris') {
        const uriStrings = val
          .map((u: Record<string, unknown>) => String(u.uri ?? ''))
          .filter(Boolean);
        result[col] = JSON.stringify(uriStrings);
      } else {
        result[col] = JSON.stringify(val);
      }
    });
  } else {
    Object.entries(row).forEach(([key, val]) => {
      if (val == null || (Array.isArray(val) && val.length === 0)) return;
      if (typeof val === 'string') {
        result[key] = val;
      } else if (typeof val === 'number' || typeof val === 'boolean') {
        result[key] = String(val);
      } else {
        result[key] = JSON.stringify(val);
      }
    });
  }

  return result;
}

function determineActiveColumns(rows: Array<Record<string, string>>): string[] {
  const columnValueMap: Record<string, string[]> = {};
  rows.forEach((row) => {
    Object.entries(row).forEach(([key, val]) => {
      if (!columnValueMap[key]) columnValueMap[key] = [];
      columnValueMap[key].push(val);
    });
  });
  const presentColumns = Object.entries(columnValueMap)
    .filter(([, vals]) => vals.some((v) => v !== ''))
    .map(([key]) => key);
  const ordered = COLUMNS_ORDER.filter((col) => presentColumns.includes(col));
  const remaining = presentColumns.filter((col) => !COLUMNS_ORDER.includes(col));
  return [...ordered, ...remaining];
}

const writePreparedDataToCsv = (
  path: string,
  data: Array<hashWithLeaksAndPasswordObjects>,
): Promise<void> => {
  const rows: Array<Record<string, string>> = data.flatMap((group) => {
    const {
      hash, leaks, readableLeaks, compactLeaks, passwordObjects,
    } = group;
    return passwordObjects.map((obj) => ({
      ...flattenNestedRow(obj as Record<string, unknown>),
      login_password_hash: hash,
      login_password_leaks: String(leaks),
      login_password_readable_leaks: readableLeaks,
      login_password_compact_leaks: compactLeaks,
    }));
  });

  const activeColumns = determineActiveColumns(rows);

  return new Promise((resolve, reject) => {
    writeToPath(path, rows, { headers: activeColumns })
      .on('error', (err) => { reject(err); })
      .on('finish', () => { resolve(); });
  });
};

export default writePreparedDataToCsv;
