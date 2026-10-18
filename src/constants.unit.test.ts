import { describe, it, expect } from 'vitest';

import {
  fullHashLengthFor,
  apiSuffixLengthFor,
  NTLM_HEX_LENGTH,
  SHA1_HEX_LENGTH,
  NTLM_API_HASH_SUFFIX_LENGTH,
  HIBP_API_HASH_LENGTH,
} from './constants.js';

describe('hash length constants', () => {
  it('exposes the SHA-1 and NTLM full-hash lengths', () => {
    expect(SHA1_HEX_LENGTH).toBe(40);
    expect(NTLM_HEX_LENGTH).toBe(32);
  });

  it('exposes the SHA-1 and NTLM suffix lengths', () => {
    expect(HIBP_API_HASH_LENGTH).toBe(35);
    expect(NTLM_API_HASH_SUFFIX_LENGTH).toBe(27);
  });

  it('keeps suffix length equal to full length minus the 5-char prefix', () => {
    expect(HIBP_API_HASH_LENGTH).toBe(SHA1_HEX_LENGTH - 5);
    expect(NTLM_API_HASH_SUFFIX_LENGTH).toBe(NTLM_HEX_LENGTH - 5);
  });
});

describe('fullHashLengthFor', () => {
  it.each([['sha1', 40], ['ntlm', 32]] as const)('fullHashLengthFor(%s) === %i', (type, expected) => {
    expect(fullHashLengthFor(type)).toBe(expected);
  });

  it('distinguishes the two hash types', () => {
    expect(fullHashLengthFor('sha1')).not.toBe(fullHashLengthFor('ntlm'));
  });
});

describe('apiSuffixLengthFor', () => {
  it.each([['sha1', 35], ['ntlm', 27]] as const)('apiSuffixLengthFor(%s) === %i', (type, expected) => {
    expect(apiSuffixLengthFor(type)).toBe(expected);
  });

  it('is always 5 less than the corresponding full hash length', () => {
    expect(apiSuffixLengthFor('sha1')).toBe(fullHashLengthFor('sha1') - 5);
    expect(apiSuffixLengthFor('ntlm')).toBe(fullHashLengthFor('ntlm') - 5);
  });
});
