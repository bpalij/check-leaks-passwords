import { parseFile } from 'fast-csv';

import { PasswordObject } from '../../types.js';

const DATE_PATTERNS = /^(revisionDate|updatedAt|modifiedDate|revision_date|createdAt|creationDate)$/i;

const TYPE_LABELS: Record<number, string> = {
  1: 'Login',
  2: 'Secure Note',
  3: 'Card',
  4: 'Identity',
};

const TYPE_WORDS: Record<string, string> = {
  login: 'Login',
  note: 'Secure Note',
  card: 'Card',
  identity: 'Identity',
};

const REPROMPT_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Require master password',
};

/**
 * Validate that a CSV row represents a valid password object.
 *
 * Checks that the row has a `login_password` field and all values
 * are strings, numbers, null, or undefined.
 *
 * @param x - The CSV row to validate.
 * @returns True if the row is a valid password object.
 */
export const validateSinglePasswordObject = (x: unknown): boolean => {
  if (x && typeof x === 'object' && typeof (x as Record<string, unknown>).login_password === 'string') {
    const keys = Object.keys(x);
    for (let i = 0; i < keys.length; i += 1) {
      const val = (x as Record<string, unknown>)[keys[i]];
      if (typeof val !== 'string' && typeof val !== 'number' && val !== null && val !== undefined) {
        return false;
      }
    }
    return true;
  }
  return false;
};

/**
 * Enrich a raw CSV row with computed fields.
 *
 * Adds `passwordAgeDays`, `typeLabel`, `repromptLabel`, `hasTotp`,
 * `folderName`, and `uriCount` from the raw CSV data.
 *
 * @param row - The raw CSV row.
 * @returns Enriched row with computed fields.
 */
function enrichRow(row: Record<string, unknown>): Record<string, unknown> {
  const enriched: Record<string, unknown> = { ...row };

  const dateKey = Object.keys(row).find(
    (key) => DATE_PATTERNS.test(key) && row[key],
  );
  if (dateKey) {
    const parsed = Date.parse(String(row[dateKey]));
    if (!Number.isNaN(parsed)) {
      enriched.passwordAgeDays = Math.floor(
        (Temporal.Now.instant().epochMilliseconds - parsed) / 86400000,
      );
    }
  }

  if (row.type !== undefined) {
    const num = Number(row.type);
    if (!Number.isNaN(num)) {
      enriched.type = num;
      enriched.typeLabel = TYPE_LABELS[num];
    } else {
      const word = String(row.type).toLowerCase();
      const WORD_TO_TYPE: Record<string, number> = {
        login: 1, note: 2, card: 3, identity: 4,
      };
      enriched.type = WORD_TO_TYPE[word] ?? row.type;
      enriched.typeLabel = TYPE_WORDS[word];
    }
  }

  if (row.reprompt !== undefined) {
    enriched.repromptLabel = REPROMPT_LABELS[Number(row.reprompt)] ?? undefined;
  }

  if (row.favorite !== undefined) {
    enriched.favorite = row.favorite === '1' || row.favorite === 1 || row.favorite === true;
  }

  enriched.hasTotp = row.login_totp !== undefined && !!String(row.login_totp);

  enriched.folderName = row.folder ?? row.collections;

  enriched.uriCount = row.login_uris
    ? (row.login_uris as Array<unknown>).length
    : undefined;

  return enriched;
}

/**
 * Read and parse a Bitwarden CSV export file.
 *
 * Handles multi-URI columns (`login_uri1`, `login_uri2`, etc.),
 * enriches rows with computed fields, and validates each row.
 * Skips rows with missing `login_password` or invalid format.
 *
 * @param path - Path to the CSV file.
 * @returns Array of password objects parsed from the CSV.
 *
 * @security Handles plaintext passwords from the CSV export.
 *   Passwords must not be logged or exposed.
 */
const readCsvInputFile = (path: string): Promise<Array<PasswordObject>> => (
  new Promise((resolve, reject) => {
    const result: Array<PasswordObject> = [];
    let skippedRows = 0;
    parseFile(path, { headers: true })
      .on('error', (error) => { reject(error); })
      .on('data', (row) => {
        if (!validateSinglePasswordObject(row)) {
          skippedRows += 1;
          return;
        }
        if (!row.login_password) return;
        const processed: Record<string, unknown> = {};
        const keys = Object.keys(row);
        for (let i = 0; i < keys.length; i += 1) {
          const key = keys[i];
          if (!/^login_uri\d*$/.test(key) && key !== 'login_uris') {
            processed[key] = row[key] === '' ? undefined : row[key];
          }
        }
        const uriKeys = Object.keys(row).filter(
          (k) => /^login_uri\d*$/.test(k) || k === 'login_uris',
        );
        if (uriKeys.length) {
          const uris: string[] = [];
          uriKeys.forEach((k) => {
            const v = row[k];
            if (v && typeof v === 'string') uris.push(v);
          });
          if (uris.length) processed.login_uris = uris;
        }
        result.push(enrichRow(processed) as PasswordObject);
      })
      .on('end', () => {
        if (skippedRows > 0) {
          process.stdout.write(`Warning: ${skippedRows} row(s) skipped (missing login_password or invalid format)\n`);
        }
        resolve(result);
      });
  })
);

export { readCsvInputFile };
