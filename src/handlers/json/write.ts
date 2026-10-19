import fs from 'fs';

import { formatNumber } from '../../formatting/formatNumber.js';
import { formatCompact } from '../../formatting/formatCompact.js';
import { stripSensitiveFields } from '../stripSensitiveFields.js';
import type { HashWithLeaksAndPasswordObjects, OutputHandlerOptions } from '../../types.js';

/**
 * Base key ordering for nested (login) password objects, without the
 * hash-value key.
 *
 * The hash key is algorithm-named (`login_password_<alg>`) and spliced in
 * by {@link buildJsonKeyOrderNested}.
 */
const JSON_KEY_ORDER_NESTED_BASE = [
  'name',
  'folderName',
  'typeLabel',
  'login',
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

/**
 * Base key ordering for flat (CSV-style) password objects, without the
 * hash-value key. See {@link JSON_KEY_ORDER_NESTED_BASE}.
 */
const JSON_KEY_ORDER_FLAT_BASE = [
  'name',
  'folderName',
  'typeLabel',
  'login_uris',
  'login_username',
  'login_password',
  'login_totp',
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

/**
 * Build the nested-variant record key ordering for a given hash type.
 *
 * Splices `login_password_<alg>` directly after `login` — the position
 * formerly held by the generic hash key — for position retention (FR-006).
 *
 * @param hashType - Effective hash type of the run (`sha1` or `ntlm`).
 * @returns Ordered array of record keys for this run.
 */
function buildJsonKeyOrderNested(hashType: 'sha1' | 'ntlm'): string[] {
  const keys = [...JSON_KEY_ORDER_NESTED_BASE];
  keys.splice(keys.indexOf('login') + 1, 0, `login_password_${hashType}`);
  return keys;
}

/**
 * Build the flat-variant record key ordering for a given hash type.
 *
 * Splices `login_password_<alg>` directly after `login_totp` — the
 * position formerly held by the generic hash key — for position retention
 * (FR-006).
 *
 * @param hashType - Effective hash type of the run (`sha1` or `ntlm`).
 * @returns Ordered array of record keys for this run.
 */
function buildJsonKeyOrderFlat(hashType: 'sha1' | 'ntlm'): string[] {
  const keys = [...JSON_KEY_ORDER_FLAT_BASE];
  keys.splice(keys.indexOf('login_totp') + 1, 0, `login_password_${hashType}`);
  return keys;
}

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
 * Outputs an array of leak groups with sorted keys and stripped empty
 * values. Group keys are `hash_<alg>`, `leaks`, `passwordObjects`; each
 * password object is enriched with `login_password_<alg>`,
 * `login_password_leaks`, `login_password_readable_leaks`, and
 * `login_password_compact_leaks`, where `<alg>` is the run's effective
 * hash type. Sensitive fields are stripped unless `includeSecrets` is true.
 *
 * @param path - Path to the output JSON file.
 * @param data - Enriched results with leak counts and password objects.
 * @param options - Output options (e.g., includeSecrets, hashType).
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
  const nestedKeyOrder = buildJsonKeyOrderNested(hashType);
  const flatKeyOrder = buildJsonKeyOrderFlat(hashType);

  const outputData = data.map((group) => ({
    [`hash_${hashType}`]: group.hash,
    leaks: group.leaks,
    passwordObjects: group.passwordObjects
      .map((obj) => {
        const withLeaks = {
          ...obj,
          [`login_password_${hashType}`]: group.hash,
          login_password_leaks: group.leaks,
          login_password_readable_leaks: formatNumber(group.leaks),
          login_password_compact_leaks: formatCompact(group.leaks),
        };
        const stripped = includeSecrets
          ? stripEmpty(withLeaks)
          : stripEmpty(stripSensitiveFields(withLeaks as Record<string, unknown>));
        if (stripped === undefined) return undefined;
        const keyOrder = 'login' in withLeaks ? nestedKeyOrder : flatKeyOrder;
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
