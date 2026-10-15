import crypto from 'crypto';

import { md4 } from '../crypto/md4.js';
import { zeroBuffer } from '../memory/secureCleanup.js';

/**
 * Compute the uppercase-hex password hash for an effective hash type.
 *
 * - `sha1`: `SHA1(password)` over the UTF-8 bytes.
 * - `ntlm`: `MD4(UTF-16LE(password))` — the NTLM password hash.
 *
 * Both branches encode the password into an explicitly owned buffer that is
 * zeroed immediately after hashing.
 *
 * @param password - The plaintext password to hash.
 * @param hashType - The effective hash type (`sha1` or `ntlm`; never `auto`).
 * @returns The uppercase hex-encoded digest (40 chars for sha1, 32 for ntlm).
 * @security Hashes password-derived data; no plaintext or digest is logged.
 *   The UTF-8 (sha1) / UTF-16LE (ntlm) password buffer is zeroed in a
 *   `finally` block to minimize the plaintext's lifetime in memory.
 */
export function hashPassword(password: string, hashType: 'sha1' | 'ntlm'): string {
  if (hashType === 'ntlm') {
    // NTLM hashes the password's UTF-16LE bytes. Buffer the bytes so they can
    // be zeroed after hashing.
    const passwordBuf = Buffer.from(password, 'utf16le');
    try {
      return md4(passwordBuf).toString('hex').toUpperCase();
    } finally {
      zeroBuffer(passwordBuf);
    }
  }

  // `crypto.hash` encodes a string as UTF-8 internally; owning the UTF-8 bytes
  // gives us a buffer we can zero afterwards with identical digests.
  const passwordBuf = Buffer.from(password, 'utf8');
  try {
    return crypto.hash('sha1', passwordBuf, 'hex').toUpperCase();
  } finally {
    zeroBuffer(passwordBuf);
  }
}
