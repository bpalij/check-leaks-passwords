import type { PasswordObject, HashWithLeaksAndPasswordObjects } from './types.js';

/**
 * Enrich hash results with their corresponding password objects.
 *
 * Maps each hash+leaks result to its full password objects from
 * the lookup map. Hashes without matching password objects get
 * an empty array.
 *
 * @param results - Array of hash/leaks pairs from the scan.
 * @param hashesWithPasswordObjects - Map of SHA-1 hashes to password objects.
 * @returns Enriched results with password objects attached.
 */
export function enrichWithPasswordObjects(
  results: ReadonlyArray<{ readonly hash: string; readonly leaks: number }>,
  hashesWithPasswordObjects: Map<string, Array<PasswordObject>>,
): Array<HashWithLeaksAndPasswordObjects> {
  return results.map((r) => ({
    hash: r.hash,
    leaks: r.leaks,
    passwordObjects: hashesWithPasswordObjects.get(r.hash) ?? [],
  }));
}
