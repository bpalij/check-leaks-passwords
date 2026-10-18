import {
  HIBP_API_HASH_LENGTH,
  NTLM_API_HASH_SUFFIX_LENGTH,
  NTLM_HEX_LENGTH,
  SHA1_HEX_LENGTH,
} from '../../src/constants.js';

/**
 * One hash algorithm's length contract across the supported corpora.
 *
 * `fullHashLength` is the length of a full hex hash in a single-file corpus,
 * `suffixLength` is the length of the hash part in a split-file/API line, and
 * `apiQuery` is the query string the HIBP range endpoint requires to serve that
 * corpus (`''` for the default SHA-1 corpus, `?mode=ntlm` for NTLM).
 */
export interface HashCase {
  type: 'sha1' | 'ntlm';
  fullHashLength: number;
  suffixLength: number;
  apiQuery: string;
}

/** SHA-1 (40-char full hash, 35-char suffix, default range corpus). */
export const SHA1_CASE: HashCase = {
  type: 'sha1',
  fullHashLength: SHA1_HEX_LENGTH,
  suffixLength: HIBP_API_HASH_LENGTH,
  apiQuery: '',
};

/** NTLM (32-char full hash, 27-char suffix, `?mode=ntlm` range corpus). */
export const NTLM_CASE: HashCase = {
  type: 'ntlm',
  fullHashLength: NTLM_HEX_LENGTH,
  suffixLength: NTLM_API_HASH_SUFFIX_LENGTH,
  apiQuery: '?mode=ntlm',
};

/** Both supported hash cases, for table-driven tests. */
export const HASH_CASES: HashCase[] = [SHA1_CASE, NTLM_CASE];

/**
 * Build a sorted single-file corpus body from `hash:count` pairs.
 *
 * Sorting is required by the binary-search and index readers; a trailing
 * newline is included so line-oriented readers see a complete final line.
 *
 * @param pairs - Full hex hashes paired with their leak counts.
 * @returns The LF-separated, sorted corpus text.
 */
export function makeSortedCorpus(pairs: Array<[string, number]>): string {
  const lines = pairs.map(([hash, count]) => `${hash}:${count}`);
  lines.sort();
  return `${lines.join('\n')}\n`;
}
