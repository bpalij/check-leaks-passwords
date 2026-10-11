import crypto from 'crypto';

import * as argon2 from 'argon2';

import { trackBuffer, untrackBuffer, zeroBuffer } from '../memory/secureCleanup.js';
import { stretchKey } from './stretchKey.js';

/**
 * Parsed Bitwarden cipher string components.
 *
 * Bitwarden encrypted exports use the format `type.iv|ciphertext[|mac]`
 * where type determines the encryption scheme and whether a MAC is present.
 */
interface ParsedCipherString {
  /** Encryption type identifier (0 = AES-CBC-256 no MAC, 2 = AES-CBC-256 with HMAC-SHA256). */
  type: number;
  /** Initialization vector (16 bytes, base64-encoded). */
  iv: Buffer;
  /** Encrypted ciphertext (base64-encoded). */
  ciphertext: Buffer;
  /** HMAC-SHA256 digest (base64-encoded). Null for type 0. */
  mac: Buffer | null;
}

/**
 * Parse a Bitwarden cipher string into its components.
 *
 * Cipher string format: `type.base64payload` where payload is `iv|ciphertext[|mac]`.
 * Type 0: AES-256-CBC without MAC (iv|ciphertext).
 * Type 2: AES-256-CBC with HMAC-SHA256 (iv|ciphertext|mac).
 *
 * @param encString - The cipher string to parse.
 * @returns Parsed cipher components.
 * @throws {Error} If the format is unrecognized or malformed.
 */
function parseCipherString(encString: string): ParsedCipherString {
  const trimmed = encString.trim();
  const dotIdx = trimmed.indexOf('.');
  if (dotIdx === -1) {
    throw new Error('Unrecognized encrypted data format');
  }
  const type = Number(trimmed.slice(0, dotIdx));
  if (Number.isNaN(type)) {
    throw new Error('Unrecognized encrypted data format');
  }
  const payload = trimmed.slice(dotIdx + 1);
  const parts = payload.split('|').map((p) => p.trim());

  if (type === 0) {
    if (parts.length < 2) {
      throw new Error('Unrecognized encrypted data format');
    }
    return {
      type,
      iv: Buffer.from(parts[0], 'base64'),
      ciphertext: Buffer.from(parts[1], 'base64'),
      mac: null,
    };
  }

  if (type === 2) {
    if (parts.length < 3) {
      throw new Error('Unrecognized encrypted data format');
    }
    return {
      type,
      iv: Buffer.from(parts[0], 'base64'),
      ciphertext: Buffer.from(parts[1], 'base64'),
      mac: Buffer.from(parts[2], 'base64'),
    };
  }

  throw new Error('Unrecognized encrypted data format');
}

/**
 * Derive the master key from the user's password using PBKDF2 or Argon2id.
 *
 * @param password - The user's export password as a Buffer.
 * @param salt - Base64-encoded salt string from the encrypted export.
 * @param kdfType - KDF algorithm: 0 = PBKDF2, 2 = Argon2id.
 * @param iterations - Number of KDF iterations (PBKDF2) or time cost (Argon2id).
 * @param memory - Argon2id memory cost in MB (ignored for PBKDF2).
 * @param parallelism - Argon2id parallelism (ignored for PBKDF2).
 * @returns 32-byte derived master key.
 * @security The returned Buffer contains key material — caller must zero it.
 */
async function deriveMasterKey(
  password: Buffer,
  salt: string,
  kdfType: number,
  iterations: number,
  memory?: number,
  parallelism?: number,
): Promise<Buffer> {
  const saltBytes = Buffer.from(salt, 'utf-8');

  if (kdfType === 0) {
    return crypto.pbkdf2Sync(password, saltBytes, iterations, 32, 'sha256');
  }

  const saltHash = crypto.createHash('sha256').update(saltBytes).digest();
  return argon2.hash(password, {
    type: argon2.argon2id,
    salt: saltHash,
    timeCost: iterations,
    memoryCost: (memory ?? 64) * 1024,
    parallelism: parallelism ?? 4,
    hashLength: 32,
    raw: true,
  }) as Promise<Buffer>;
}

/**
 * Verify the HMAC-SHA256 of an AES-CBC ciphertext.
 *
 * Computes HMAC-SHA256(macKey, iv || ciphertext) and compares with the expected
 * MAC using timing-safe comparison to prevent timing side-channel attacks.
 *
 * @param macKey - The MAC key derived from the master key.
 * @param iv - The initialization vector.
 * @param ciphertext - The encrypted ciphertext.
 * @param expectedMac - The expected HMAC digest.
 * @throws {Error} If the MAC does not match (wrong password or corrupted data).
 */
function verifyMac(macKey: Buffer, iv: Buffer, ciphertext: Buffer, expectedMac: Buffer): void {
  const hmac = crypto.createHmac('sha256', macKey);
  hmac.update(iv);
  hmac.update(ciphertext);
  const computed = hmac.digest();
  // Length check must precede timingSafeEqual — it throws on unequal lengths,
  // which would leak whether the mismatch is length vs content.
  if (computed.length !== expectedMac.length || !crypto.timingSafeEqual(computed, expectedMac)) {
    throw new Error('Incorrect password or corrupted export');
  }
}

/**
 * Remove PKCS7 padding from a decrypted buffer.
 *
 * PKCS7 padding fills the last block with bytes equal to the padding length.
 * Each padding byte must be in range [1, blockSize] and all must match.
 *
 * @param buf - The padded decrypted buffer.
 * @returns Buffer with padding removed.
 * @throws {Error} If padding is invalid (wrong password or corrupted data).
 */
function removePkcs7Padding(buf: Buffer): Buffer {
  if (buf.length === 0) {
    throw new Error('Incorrect password or corrupted export');
  }
  const padLen = buf[buf.length - 1];
  // padLen must be in [1, blockSize(16)] — out-of-range means wrong key produced garbage
  if (padLen < 1 || padLen > 16) {
    throw new Error('Incorrect password or corrupted export');
  }
  // Every padding byte must equal padLen; any mismatch means corrupted ciphertext
  for (let i = 1; i <= padLen; i += 1) {
    if (buf[buf.length - i] !== padLen) {
      throw new Error('Incorrect password or corrupted export');
    }
  }
  return buf.subarray(0, buf.length - padLen);
}

/**
 * Decrypt an AES-256-CBC cipher string with optional HMAC verification.
 *
 * Parses the cipher string, verifies the MAC if present, decrypts with
 * AES-256-CBC, and removes PKCS7 padding.
 *
 * @param encKey - The 32-byte encryption key.
 * @param macKey - The 32-byte MAC key.
 * @param encString - The Bitwarden cipher string to decrypt.
 * @returns Decrypted plaintext buffer.
 * @throws {Error} If MAC verification fails or padding is invalid.
 */
function decryptAesCbc256Hmac(
  encKey: Buffer,
  macKey: Buffer,
  encString: string,
): Buffer {
  const parsed = parseCipherString(encString);
  if (parsed.mac) {
    verifyMac(macKey, parsed.iv, parsed.ciphertext, parsed.mac);
  }
  const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, parsed.iv);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]);
  return removePkcs7Padding(decrypted);
}

/**
 * Validate the user's password by decrypting the embedded validation field.
 *
 * The validation field contains a UUID v4 that was encrypted during export.
 * If decryption produces a valid UUID, the password is correct.
 *
 * @param validationEncString - The encrypted validation cipher string.
 * @param encKey - The encryption key.
 * @param macKey - The MAC key.
 * @throws {Error} If the decrypted value is not a valid UUID v4 (wrong password).
 */
function validatePassword(validationEncString: string, encKey: Buffer, macKey: Buffer): void {
  const decrypted = decryptAesCbc256Hmac(encKey, macKey, validationEncString);
  const str = decrypted.toString('utf-8');
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidV4Regex.test(str)) {
    throw new Error('Incorrect password or corrupted export');
  }
}

/**
 * Decrypt a password-protected Bitwarden encrypted export.
 *
 * Derives the master key from the password using PBKDF2 or Argon2id,
 * stretches it to enc/mac keys via HKDF, validates the key against
 * the embedded validation field, then decrypts the vault payload
 * using AES-256-CBC with HMAC-SHA256 verification.
 *
 * @param rawJson - Raw JSON string of the encrypted Bitwarden export.
 * @param password - User-provided export password.
 * @returns Decrypted vault JSON string.
 * @throws {Error} If the JSON is invalid, not a password-protected export,
 *   or the password is incorrect.
 *
 * @security Zeroes all intermediate key material in a `finally` block.
 *   The returned JSON contains plaintext vault data — caller must handle
 *   lifecycle and avoid logging.
 */
export async function decryptBitwardenExport(
  rawJson: string,
  password: string,
): Promise<string> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawJson) as Record<string, unknown>;
  } catch {
    throw new Error('Invalid JSON in encrypted export');
  }

  if (parsed.encrypted !== true) {
    throw new Error('This does not appear to be an encrypted Bitwarden export');
  }

  if (parsed.passwordProtected !== true) {
    throw new Error(
      'This is an account-restricted encrypted export'
      + ' (encrypted with your Bitwarden account key),'
      + ' not a password-protected export.'
      + ' This tool cannot decrypt account-restricted exports.\n\n'
      + 'To fix this, re-export your vault from Bitwarden:\n'
      + '  1. Go to Tools > Export vault\n'
      + '  2. Select "Password-protected" (not the default option)\n'
      + '  3. Set a password when prompted\n'
      + '  4. Use that password with --export-password'
      + ' or the EXPORT_PASSWORD env var',
    );
  }

  const kdfType = Number(parsed.kdfType);
  if (kdfType !== 0 && kdfType !== 2) {
    throw new Error(`Unsupported KDF type: ${kdfType}. Supported: PBKDF2 (0), Argon2id (2).`);
  }

  const { salt } = parsed;
  if (typeof salt !== 'string' || !salt) {
    throw new Error('Encrypted export is missing the salt field');
  }

  const iterations = Number(parsed.kdfIterations);
  if (Number.isNaN(iterations) || iterations < 1) {
    throw new Error('Encrypted export has invalid kdfIterations');
  }

  const encKeyValidation = parsed.encKeyValidation_DO_NOT_EDIT;
  if (typeof encKeyValidation !== 'string' || !encKeyValidation) {
    throw new Error('Encrypted export is missing the validation field');
  }

  const { data } = parsed;
  if (typeof data !== 'string' || !data) {
    throw new Error('Encrypted export is missing the data field');
  }

  const passwordBuf = Buffer.from(password, 'utf-8');
  let masterKey: Buffer | null = null;
  let encKey: Buffer | null = null;
  let macKey: Buffer | null = null;

  try {
    masterKey = await deriveMasterKey(
      passwordBuf,
      salt,
      kdfType,
      iterations,
      parsed.kdfMemory != null ? Number(parsed.kdfMemory) : undefined,
      parsed.kdfParallelism != null ? Number(parsed.kdfParallelism) : undefined,
    );
    zeroBuffer(passwordBuf);

    const stretched = stretchKey(masterKey);
    zeroBuffer(masterKey);
    masterKey = null;

    encKey = stretched.encKey;
    macKey = stretched.macKey;
    trackBuffer(encKey);
    trackBuffer(macKey);

    validatePassword(encKeyValidation as string, encKey, macKey);

    const vaultBuf = decryptAesCbc256Hmac(encKey, macKey, data as string);
    const vaultJson = vaultBuf.toString('utf-8');

    return vaultJson;
  } finally {
    zeroBuffer(passwordBuf);
    zeroBuffer(masterKey);
    if (encKey) {
      zeroBuffer(encKey);
      untrackBuffer(encKey);
    }
    if (macKey) {
      zeroBuffer(macKey);
      untrackBuffer(macKey);
    }
  }
}
