import { writeToPath } from 'fast-csv';

import { formatNumber } from '../../formatting/formatNumber.js';
import { formatCompact } from '../../formatting/formatCompact.js';
import { stripSensitiveFields } from '../stripSensitiveFields.js';
import type { HashWithLeaksAndPasswordObjects, OutputHandlerOptions } from '../../types.js';

/** Preferred column ordering for CSV output. */
const COLUMNS_ORDER = [
  'name',
  'folderName',
  'typeLabel',
  'type',
  'login_uris',
  'login_username',
  'login_password',
  'login_password_hash',
  'login_password_hash_type',
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

/**
 * Flatten a password object (nested or flat) into a single-row record.
 *
 * Nested objects with a `login` property are flattened by prefixing
 * login sub-keys with `login_`. URI arrays are serialized as JSON string arrays.
 * All non-string values are converted to strings or JSON-serialized.
 *
 * @param row - The password object to flatten.
 * @returns A flat record suitable for CSV output.
 */
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

/**
 * Determine which columns to include in the CSV output.
 *
 * Columns are ordered by COLUMNS_ORDER first, then any remaining
 * columns are appended alphabetically. Only columns with at least
 * one non-empty value are included.
 *
 * @param rows - The flattened rows to determine columns from.
 * @returns Ordered array of active column names.
 */
function determineActiveColumns(rows: Array<Record<string, string>>): string[] {
  const columnValueMap: Record<string, string[]> = {};
  rows.forEach((row) => {
    Object.entries(row).forEach(([key, val]) => {
      columnValueMap[key] ??= [];
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

/**
 * Write enriched leak results to a CSV file.
 *
 * Flattens nested password objects, enriches with leak metadata
 * (hash, leaks count, readable/compact leaks), and writes to a
 * CSV file using fast-csv. Sensitive fields are stripped unless
 * `includeSecrets` is true.
 *
 * @param path - Path to the output CSV file.
 * @param data - Enriched results with leak counts and password objects.
 * @param options - Output options (e.g., includeSecrets).
 *
 * @security Strips all sensitive fields (passwords, TOTP, FIDO2, passwordHistory)
 *   unless `includeSecrets` is explicitly set to true.
 */
export const writePreparedDataToCsv = (
  path: string,
  data: Array<HashWithLeaksAndPasswordObjects>,
  options: OutputHandlerOptions = {},
): Promise<void> => {
  const includeSecrets = options.includeSecrets ?? false;
  const hashType = options.hashType ?? 'sha1';

  const rows: Array<Record<string, string>> = data.flatMap((group) => {
    const {
      hash, leaks, passwordObjects,
    } = group;
    return passwordObjects.map((obj) => {
      const enriched = {
        ...obj,
        login_password_hash: hash,
        login_password_hash_type: hashType,
        login_password_leaks: String(leaks),
        login_password_readable_leaks: formatNumber(leaks),
        login_password_compact_leaks: formatCompact(leaks),
      };
      const row = includeSecrets
        ? flattenNestedRow(enriched as Record<string, unknown>)
        : flattenNestedRow(
          stripSensitiveFields(enriched as Record<string, unknown>),
        );
      return row;
    });
  });

  const activeColumns = determineActiveColumns(rows);

  return new Promise((resolve, reject) => {
    writeToPath(path, rows, { headers: activeColumns })
      .on('error', (err) => { reject(err); })
      .on('finish', () => { resolve(); });
  });
};
