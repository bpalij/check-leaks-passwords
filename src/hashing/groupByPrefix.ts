import { PasswordObject, HashLookupEntry } from '../types.js';
import { SHA1_HEX_LENGTH } from '../constants.js';

/**
 * Group password hashes by their prefix for split-file or API processing.
 *
 * For each unique prefix (e.g., first 5 hex characters), creates a separate
 * lookup map and fingerprint set containing only hashes with that prefix.
 * This enables:
 * - Split-directory processing: one file per prefix.
 * - HIBP API queries: one API call per prefix.
 *
 * @param hashesWithPasswordObjects - Map from full hex hash to password objects.
 * @param prefixLength - Number of hex characters to use as the prefix.
 * @param fullHashLength - Length of a full hex hash (40 for SHA-1, 32 for NTLM).
 *   Defaults to 40 (SHA-1).
 * @returns Map from prefix string to { map, set } for that prefix's hashes.
 *
 * @security The returned maps contain password hashes — treat as sensitive.
 */
export function groupHashesByPrefix(
  hashesWithPasswordObjects: Map<string, Array<PasswordObject>>,
  prefixLength: number,
  fullHashLength: number = SHA1_HEX_LENGTH,
): Map<string, {
  map: Map<number, HashLookupEntry[]>;
  set: Set<number>;
}> {
  const prefixToSuffix = new Map<
    string,
    { map: Map<number, HashLookupEntry[]>; set: Set<number> }
  >();
  hashesWithPasswordObjects.forEach((_objects, fullHash) => {
    const prefix = fullHash.slice(0, prefixLength);
    const fullHashBuf = Buffer.from(fullHash, 'ascii');
    const key1 = fullHashBuf.readUInt32BE(prefixLength);

    const entry: HashLookupEntry = {
      fullHash,
      fullHashBytes: fullHashBuf.subarray(0, fullHashLength),
    };

    const group = prefixToSuffix.getOrInsert(prefix, { map: new Map(), set: new Set() });

    group.set.add(key1);

    group.map.getOrInsert(key1, []).push(entry);
  });
  return prefixToSuffix;
}
