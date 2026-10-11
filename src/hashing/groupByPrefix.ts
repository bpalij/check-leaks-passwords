import { PasswordObject, HashLookupEntry } from '../types.js';

/**
 * Group password hashes by their prefix for split-file or API processing.
 *
 * For each unique prefix (e.g., first 5 hex characters), creates a separate
 * lookup map and fingerprint set containing only hashes with that prefix.
 * This enables:
 * - Split-directory processing: one file per prefix.
 * - HIBP API queries: one API call per prefix.
 *
 * @param hashesWithPasswordObjects - Map from full SHA-1 hex hash to password objects.
 * @param prefixLength - Number of hex characters to use as the prefix.
 * @returns Map from prefix string to { map, set } for that prefix's hashes.
 *
 * @security The returned maps contain SHA-1 hashes — treat as sensitive.
 */
export function groupHashesByPrefix(
  hashesWithPasswordObjects: Map<string, Array<PasswordObject>>,
  prefixLength: number,
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
      fullHashBytes: fullHashBuf.subarray(0, 40),
    };

    const group = prefixToSuffix.getOrInsert(prefix, { map: new Map(), set: new Set() });

    group.set.add(key1);

    group.map.getOrInsert(key1, []).push(entry);
  });
  return prefixToSuffix;
}
