import { PasswordObject, HashLookupEntry } from '../types.js';

/**
 * Build a hash lookup map from password hashes.
 *
 * Creates a two-level lookup structure for fast hash matching:
 * - `map`: Maps the first 4 bytes (32-bit key) to candidate `HashLookupEntry` objects.
 * - `set`: Set of all 4-byte keys for fast rejection (fingerprint optimization).
 *
 * The 4-byte key provides O(1) lookup in the hot path. The candidate list
 * is then scanned with byte-by-byte comparison for the remaining 36 characters.
 *
 * @param hashes - Map from SHA-1 hex hash to password objects.
 * @returns Object containing the lookup map and fingerprint set.
 *
 * @security The map contains SHA-1 hashes of passwords — treat as sensitive.
 */
export function buildHashLookupMap(
  hashes: Map<string, Array<PasswordObject>>,
): { map: Map<number, HashLookupEntry[]>; set: Set<number> } {
  const map = new Map<number, HashLookupEntry[]>();
  const set = new Set<number>();
  hashes.forEach((_objects, hash) => {
    const hashBuf = Buffer.from(hash, 'ascii');
    const firstFourBytesInt = hashBuf.readUInt32BE(0);
    set.add(firstFourBytesInt);
    const entry: HashLookupEntry = {
      fullHash: hash,
      fullHashBytes: hashBuf.subarray(0, 40),
    };
    map.getOrInsert(firstFourBytesInt, []).push(entry);
  });
  return { map, set };
}
