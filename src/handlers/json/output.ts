import fs from 'fs';
import { hashWithLeaksAndPasswordObjects } from '../../interfaces/types';

const JSON_KEY_ORDER_NESTED = [
  'name', 'folderName', 'typeLabel',
  'login',
  'login_password_hash', 'login_password_leaks', 'login_password_readable_leaks', 'login_password_compact_leaks',
  'hasTotp', 'hasPasskey', 'uriCount', 'hasCustomFields', 'passwordAgeDays',
  'notes', 'organizationId', 'deletedDate',
  'id', 'folderId', 'favorite', 'type', 'reprompt', 'repromptLabel',
  'revisionDate', 'creationDate', 'archivedDate',
  'fields', 'passwordHistory', 'collectionIds',
];

const JSON_KEY_ORDER_FLAT = [
  'name', 'folderName', 'typeLabel',
  'login_uris', 'login_username', 'login_password', 'login_totp',
  'login_password_hash', 'login_password_leaks', 'login_password_readable_leaks', 'login_password_compact_leaks',
  'hasTotp', 'uriCount', 'passwordAgeDays',
  'notes', 'organizationId', 'deletedDate',
  'favorite', 'type', 'reprompt',
  'revisionDate', 'creationDate', 'archivedDate',
];

const JSON_KEY_ORDER_LOGIN = [
  'login_uris', 'username', 'password', 'totp', 'fido2Credentials', 'uris',
];

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

function stripEmpty(val: unknown): unknown {
  if (val === null || val === undefined || val === '' || (typeof val === 'number' && Number.isNaN(val))) return undefined;
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

const writeJsonOutputFile = async (
  path: string,
  data: Array<hashWithLeaksAndPasswordObjects>,
): Promise<void> => {
  const outputData = data.map((group) => ({
    ...group,
    passwordObjects: group.passwordObjects
      .map((obj) => {
        const withLeaks = {
          ...obj,
          login_password_hash: group.hash,
          login_password_leaks: group.leaks,
          login_password_readable_leaks: group.readableLeaks,
          login_password_compact_leaks: group.compactLeaks,
        };
        const stripped = stripEmpty(withLeaks);
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

export default writeJsonOutputFile;
