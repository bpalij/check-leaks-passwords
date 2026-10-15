import { PasswordObject, HashLookupEntry } from '../types.js';
import { SHA1_HEX_LENGTH } from '../constants.js';

/**
 * Build a hash lookup map from password hashes.
 *
 * Creates a two-level lookup structure for fast hash matching:
 * - `map`: Maps the first 4 bytes (32-bit key) to candidate `HashLookupEntry` objects.
 * - `set`: Set of all 4-byte keys for fast rejection (fingerprint optimization).
 *
 * The 4-byte key provides O(1) lookup in the hot path. The candidate list
 * is then scanned with byte-by-byte comparison for the remaining characters.
 *
 * @param hashes - Map from full hex hash to password objects.
 * @param fullHashLength - Length of a full hex hash (40 for SHA-1, 32 for NTLM).
 *   Defaults to 40 (SHA-1).
 * @returns Object containing the lookup map and fingerprint set.
 *
 * @security The map contains password hashes — treat as sensitive.
 */
export function buildHashLookupMap(
  hashes: Map<string, Array<PasswordObject>>,
  fullHashLength: number = SHA1_HEX_LENGTH,
): { map: Map<number, HashLookupEntry[]>; set: Set<number> } {
  const map = new Map<number, HashLookupEntry[]>();
  const set = new Set<number>();
  hashes.forEach((_objects, hash) => {
    const hashBuf = Buffer.from(hash, 'ascii');
    const firstFourBytesInt = hashBuf.readUInt32BE(0);
    set.add(firstFourBytesInt);
    const entry: HashLookupEntry = {
      fullHash: hash,
      fullHashBytes: hashBuf.subarray(0, fullHashLength),
    };
    map.getOrInsert(firstFourBytesInt, []).push(entry);
  });
  return { map, set };
}
