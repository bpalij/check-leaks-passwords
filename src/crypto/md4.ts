/* eslint-disable no-bitwise */
import { Buffer } from 'buffer';

/**
 * Initial MD4 state words (RFC 1320 §3.3).
 *
 * A = 0x67452301, B = 0xefcdab89, C = 0x98badcfe, D = 0x10325476.
 */
const A_INIT = 0x6745_2301;
const B_INIT = 0xefcd_ab89;
const C_INIT = 0x98ba_dcfe;
const D_INIT = 0x1032_5476;

/** Round 2 additive constant (0x5A827999), little-endian per word. */
const K2 = 0x5a82_7999;

/** Round 3 additive constant (0x6ED9EBA1), little-endian per word. */
const K3 = 0x6ed9_eba1;

/**
 * Group bases for round 3 of MD4.
 *
 * RFC 1320 schedules round 3 message indices as (0,8,4,12), (2,10,6,14),
 * (1,9,5,13), (3,11,7,15) — note the non-sequential bases.
 */
const ROUND3_BASES = [
  0,
  2,
  1,
  3,
] as const;

/**
 * Rotate a 32-bit word left by `n` bits.
 *
 * @param x - The 32-bit value (may be signed).
 * @param n - Rotation amount in bits (1..31).
 * @returns The rotated value as an unsigned 32-bit integer.
 */
function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

/**
 * MD4 round-1 boolean function: `(x & y) | (~x & z)`.
 *
 * @param x - First word.
 * @param y - Second word.
 * @param z - Third word.
 * @returns The function result as an unsigned 32-bit integer.
 */
function fFn(x: number, y: number, z: number): number {
  return ((x & y) | (~x & z)) >>> 0;
}

/**
 * MD4 round-2 boolean function: `(x & y) | (x & z) | (y & z)` (majority).
 *
 * @param x - First word.
 * @param y - Second word.
 * @param z - Third word.
 * @returns The function result as an unsigned 32-bit integer.
 */
function gFn(x: number, y: number, z: number): number {
  return ((x & y) | (x & z) | (y & z)) >>> 0;
}

/**
 * MD4 round-3 boolean function: `x ^ y ^ z` (parity).
 *
 * @param x - First word.
 * @param y - Second word.
 * @param z - Third word.
 * @returns The function result as an unsigned 32-bit integer.
 */
function hFn(x: number, y: number, z: number): number {
  return (x ^ y ^ z) >>> 0;
}

/**
 * Compute the MD4 message digest (RFC 1320) of a buffer.
 *
 * Self-contained implementation used for NTLM password hashing. Node/OpenSSL 3
 * no longer expose `md4` without the legacy provider, which the project
 * deliberately avoids (cryptographic weakening). MD4 is deterministic and this
 * implementation is pinned to the NTLM reference vectors in the test suite.
 *
 * @param input - The bytes to digest (must NOT be modified).
 * @returns A fresh 16-byte digest buffer.
 * @security Operates on password-derived data. The input buffer is not
 *   modified, but the internal `padded` buffer (password + padding) and the
 *   `x` message-word array are zeroed in a `finally` block after the digest is
 *   computed, so no password-derived copy outlives the call.
 */
export function md4(input: Buffer): Buffer {
  const bitLength = input.length * 8;

  // Pad: append 0x80, zero-fill to 56 mod 64, then the 64-bit LE bit length.
  const withOne = input.length + 1;
  const zeros = (56 - (withOne % 64) + 64) % 64;
  const padded = Buffer.alloc(withOne + zeros + 8);
  const x = new Uint32Array(16);

  try {
    input.copy(padded, 0, 0, input.length);
    padded[input.length] = 0x80;
    padded.writeBigUInt64LE(BigInt(bitLength), withOne + zeros);

    let a = A_INIT;
    let b = B_INIT;
    let c = C_INIT;
    let d = D_INIT;

    for (let chunk = 0; chunk < padded.length; chunk += 64) {
      for (let i = 0; i < 16; i += 1) {
        x[i] = padded.readUInt32LE(chunk + i * 4);
      }

      let aa = a;
      let bb = b;
      let cc = c;
      let dd = d;

      // Round 1 — F, shifts 3,7,11,19, indices sequential in groups of 4.
      for (let g = 0; g < 4; g += 1) {
        const base = g * 4;
        aa = rotl((aa + fFn(bb, cc, dd) + x[base]) >>> 0, 3);
        dd = rotl((dd + fFn(aa, bb, cc) + x[base + 1]) >>> 0, 7);
        cc = rotl((cc + fFn(dd, aa, bb) + x[base + 2]) >>> 0, 11);
        bb = rotl((bb + fFn(cc, dd, aa) + x[base + 3]) >>> 0, 19);
      }

      // Round 2 — G, shifts 3,5,9,13, stride-4 indices.
      for (let g = 0; g < 4; g += 1) {
        aa = rotl((aa + gFn(bb, cc, dd) + x[g] + K2) >>> 0, 3);
        dd = rotl((dd + gFn(aa, bb, cc) + x[g + 4] + K2) >>> 0, 5);
        cc = rotl((cc + gFn(dd, aa, bb) + x[g + 8] + K2) >>> 0, 9);
        bb = rotl((bb + gFn(cc, dd, aa) + x[g + 12] + K2) >>> 0, 13);
      }

      // Round 3 — H, shifts 3,9,11,15, non-sequential bases.
      for (let g = 0; g < 4; g += 1) {
        const base = ROUND3_BASES[g];
        aa = rotl((aa + hFn(bb, cc, dd) + x[base] + K3) >>> 0, 3);
        dd = rotl((dd + hFn(aa, bb, cc) + x[base + 8] + K3) >>> 0, 9);
        cc = rotl((cc + hFn(dd, aa, bb) + x[base + 4] + K3) >>> 0, 11);
        bb = rotl((bb + hFn(cc, dd, aa) + x[base + 12] + K3) >>> 0, 15);
      }

      a = (a + aa) >>> 0;
      b = (b + bb) >>> 0;
      c = (c + cc) >>> 0;
      d = (d + dd) >>> 0;
    }

    const digest = Buffer.alloc(16);
    digest.writeUInt32LE(a, 0);
    digest.writeUInt32LE(b, 4);
    digest.writeUInt32LE(c, 8);
    digest.writeUInt32LE(d, 12);
    return digest;
  } finally {
    // Clear all password-derived working state, even if hashing throws.
    padded.fill(0);
    x.fill(0);
  }
}
