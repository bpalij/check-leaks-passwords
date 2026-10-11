import { buildHashLookupMap } from '../../src/hashing/buildLookupMap.js';
import type { PasswordObject } from '../../src/types.js';

/**
 * Build a lookup map, fingerprint set, and password map from hash/password pairs.
 *
 * Wraps `buildHashLookupMap` to reduce boilerplate in readMode tests.
 *
 * @param hashes - Array of SHA-1 hex hashes (uppercase).
 * @param passwords - Parallel array of plaintext passwords.
 * @returns Object with `map`, `set`, and `pwMap` ready for reader functions.
 */
export function makeLookupMap(
  hashes: string[],
  passwords: string[],
) {
  const pwMap = new Map<string, PasswordObject[]>();
  hashes.forEach((h, i) => {
    pwMap.set(h, [{ login_password: passwords[i] }]);
  });
  return { ...buildHashLookupMap(pwMap), pwMap };
}
