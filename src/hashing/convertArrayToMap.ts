import { PasswordObject, PasswordObjectWithHash } from '../types.js';

/**
 * Convert an array of password objects with hashes into a grouped map.
 *
 * Groups password objects by their SHA-1 hash, creating a map where each
 * key is a hash and the value is an array of all password objects sharing
 * that hash (deduplication at the hash level).
 *
 * @param arrayWithHashes - Array of password objects paired with their hashes.
 * @returns Map from SHA-1 hex hash to array of password objects.
 */
export function convertArrayToMap(
  arrayWithHashes: Array<Readonly<PasswordObjectWithHash>>,
): Map<string, Array<Readonly<PasswordObject>>> {
  const map: Map<string, Array<Readonly<PasswordObject>>> = new Map();
  arrayWithHashes.forEach((objWithHash) => {
    map.getOrInsert(objWithHash.hash, []).push(objWithHash.passwordObject);
  });
  return map;
}
