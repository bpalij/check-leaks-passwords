import crypto from 'crypto';

/**
 * HKDF-like expansion step: derive a 32-byte key from the PRK using HMAC-SHA256.
 *
 * Implements a simplified HKDF-Expand with info="enc" or info="mac" and
 * fixed 32-byte output. Uses a single HMAC iteration (sufficient for
 * the fixed-length case with a single block).
 *
 * @param prk - Pseudo-random key (the master key).
 * @param info - Context string ("enc" or "mac") to bind the derived key.
 * @param length - Output length in bytes (always 32).
 * @returns Derived key buffer.
 * @security The returned Buffer contains key material — caller must zero it.
 */
function hkdfExpand(prk: Buffer, info: string, length: number): Buffer {
  const infoBuf = Buffer.from(info, 'utf-8');
  const hmac = crypto.createHmac('sha256', prk);
  hmac.update(infoBuf);
  // Counter byte 0x01 per RFC 5869 §2.2 — only one block needed for 32-byte output
  hmac.update(Buffer.from([0x01]));
  return hmac.digest().subarray(0, length);
}

/**
 * Stretch a 32-byte master key into separate encryption and MAC keys.
 *
 * Uses HKDF-like expansion with different `info` contexts to derive
 * two independent 32-byte keys: one for AES-256-CBC encryption and
 * one for HMAC-SHA256 verification.
 *
 * @param masterKey - The 32-byte master key derived from the password.
 * @returns Object containing `encKey` (for AES-256-CBC) and `macKey` (for HMAC-SHA256).
 * @security Both returned Buffers contain key material — caller must zero them.
 */
export function stretchKey(masterKey: Buffer): { encKey: Buffer; macKey: Buffer } {
  return {
    encKey: hkdfExpand(masterKey, 'enc', 32),
    macKey: hkdfExpand(masterKey, 'mac', 32),
  };
}
