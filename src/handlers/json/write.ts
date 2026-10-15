import fs from 'fs';

import { formatNumber } from '../../formatting/formatNumber.js';
import { formatCompact } from '../../formatting/formatCompact.js';
import { stripSensitiveFields } from '../stripSensitiveFields.js';
import type { HashWithLeaksAndPasswordObjects, OutputHandlerOptions } from '../../types.js';

/** Key ordering for nested (login) password objects. */
const JSON_KEY_ORDER_NESTED = [
  'name',
  'folderName',
  'typeLabel',
  'login',
  'login_password_hash',
  'login_password_hash_type',
  'login_password_leaks',
  'login_password_readable_leaks',
  'login_password_compact_leaks',
  'hasTotp',
  'hasPasskey',
  'uriCount',
  'hasCustomFields',
  'passwordAgeDays',
  'notes',
  'organizationId',
  'deletedDate',
  'id',
  'folderId',
  'favorite',
  'type',
  'reprompt',
  'repromptLabel',
  'revisionDate',
  'creationDate',
  'archivedDate',
  'fields',
  'passwordHistory',
  'collectionIds',
];

/** Key ordering for flat (CSV-style) password objects. */
const JSON_KEY_ORDER_FLAT = [
  'name',
  'folderName',
  'typeLabel',
  'login_uris',
  'login_username',
  'login_password',
  'login_totp',
  'login_password_hash',
  'login_password_hash_type',
  'login_password_leaks',
  'login_password_readable_leaks',
  'login_password_compact_leaks',
  'hasTotp',
  'uriCount',
  'passwordAgeDays',
  'notes',
  'organizationId',
  'deletedDate',
  'favorite',
  'type',
  'reprompt',
  'revisionDate',
  'creationDate',
  'archivedDate',
];

/** Key ordering for nested login sub-objects. */
const JSON_KEY_ORDER_LOGIN = [
  'login_uris',
  'username',
  'password',
  'totp',
  'fido2Credentials',
  'uris',
];

/**
 * Sort object keys according to a predefined order.
 *
 * Keys in keyOrder are placed first in order; remaining keys are
 * appended alphabetically.
 *
 * @param obj - The object to sort.
 * @param keyOrder - The desired key order.
 * @returns A new object with sorted keys.
 */
function sortObjectKeys(
  obj: Record<string, unknown>,
  keyOrder: string[],
): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  keyOrder.forEach((key) => {
    if (key in obj) sorted[key] = obj[key];
  });
  Object.keys(obj)
    .filter((key) => !keyOrder.includes(key))
    .sort()
    .forEach((key) => { sorted[key] = obj[key]; });
  return sorted;
}

/**
 * Recursively strip empty values (null, undefined, empty string, NaN).
 *
 * Arrays are cleaned by removing undefined entries. Objects are cleaned
 * by removing keys with empty values. Date instances are preserved.
 *
 * @param val - The value to clean.
 * @returns The cleaned value, or undefined if the value was empty.
 */
function stripEmpty(val: unknown): unknown {
  if (val === null || val === undefined || val === '' || (typeof val === 'number' && Number.isNaN(val))) return undefined;
  if (val instanceof Date) return val;
  if (Array.isArray(val)) {
    const cleaned = val.map(stripEmpty).filter((x) => x !== undefined);
    return cleaned.length ? cleaned : undefined;
  }
  if (typeof val === 'object') {
    const result: Record<string, unknown> = {};
    Object.entries(val as Record<string, unknown>).forEach(([key, v]) => {
      const cleaned = stripEmpty(v);
      if (cleaned !== undefined) result[key] = cleaned;
    });
    return Object.keys(result).length ? result : undefined;
  }
  return val;
}

/**
 * Write enriched leak results to a JSON file.
 *
 * Outputs a flat array with sorted keys and stripped empty values.
 * Each password object is enriched with `login_password_hash`,
 * `login_password_leaks`, `login_password_readable_leaks`, and
 * `login_password_compact_leaks`. Sensitive fields are stripped
 * unless `includeSecrets` is true.
 *
 * @param path - Path to the output JSON file.
 * @param data - Enriched results with leak counts and password objects.
 * @param options - Output options (e.g., includeSecrets).
 *
 * @security Strips all sensitive fields (passwords, TOTP, FIDO2, passwordHistory)
 *   unless `includeSecrets` is explicitly set to true.
 */
export const writeJsonOutputFile = async (
  path: string,
  data: Array<HashWithLeaksAndPasswordObjects>,
  options: OutputHandlerOptions = {},
): Promise<void> => {
  const includeSecrets = options.includeSecrets ?? false;
  const hashType = options.hashType ?? 'sha1';

  const outputData = data.map((group) => ({
    ...group,
    passwordObjects: group.passwordObjects
      .map((obj) => {
        const withLeaks = {
          ...obj,
          login_password_hash: group.hash,
          login_password_hash_type: hashType,
          login_password_leaks: group.leaks,
          login_password_readable_leaks: formatNumber(group.leaks),
          login_password_compact_leaks: formatCompact(group.leaks),
        };
        const stripped = includeSecrets
          ? stripEmpty(withLeaks)
          : stripEmpty(stripSensitiveFields(withLeaks as Record<string, unknown>));
        if (stripped === undefined) return undefined;
        const keyOrder = 'login' in withLeaks ? JSON_KEY_ORDER_NESTED : JSON_KEY_ORDER_FLAT;
        const sorted = sortObjectKeys(stripped as Record<string, unknown>, keyOrder);
        if (sorted.login && typeof sorted.login === 'object') {
          sorted.login = sortObjectKeys(
            sorted.login as Record<string, unknown>,
            JSON_KEY_ORDER_LOGIN,
          );
        }
        return sorted;
      })
      .filter((x): x is Record<string, unknown> => x !== undefined),
  }));
  await fs.promises.writeFile(
    path,
    JSON.stringify(outputData, undefined, 2),
  );
};
