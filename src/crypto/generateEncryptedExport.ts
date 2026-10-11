import crypto from 'crypto';

import { stretchKey } from './stretchKey.js';

/**
 * Generate an HMAC-SHA256 MAC for AES-CBC ciphertext verification.
 *
 * Computes HMAC-SHA256(macKey, iv || ciphertext) — the same verification
 * used by Bitwarden's encryption scheme.
 *
 * @param macKey - The 32-byte MAC key.
 * @param iv - The 16-byte initialization vector.
 * @param ciphertext - The encrypted ciphertext.
 * @returns 32-byte HMAC digest.
 */
function generateMac(macKey: Buffer, iv: Buffer, ciphertext: Buffer): Buffer {
  const hmac = crypto.createHmac('sha256', macKey);
  hmac.update(iv);
  hmac.update(ciphertext);
  return hmac.digest();
}

/**
 * Apply PKCS7 padding to a buffer for AES-CBC encryption.
 *
 * Fills the last incomplete block with bytes equal to the padding length.
 * If the data is already block-aligned, adds a full block of padding.
 *
 * @param data - The plaintext buffer to pad.
 * @param blockSize - AES block size (16 bytes).
 * @returns Padded buffer aligned to blockSize.
 */
function padPkcs7(data: Buffer, blockSize: number): Buffer {
  const padLen = blockSize - (data.length % blockSize);
  const pad = Buffer.alloc(padLen, padLen);
  return Buffer.concat([data, pad]);
}

/**
 * Encrypt plaintext using AES-256-CBC with HMAC-SHA256.
 *
 * Generates a random 16-byte IV, applies PKCS7 padding, encrypts with
 * AES-256-CBC, computes the MAC, and returns the Bitwarden cipher string
 * format: `2.<iv_b64>|<ciphertext_b64>|<mac_b64>`.
 *
 * @param encKey - The 32-byte encryption key.
 * @param macKey - The 32-byte MAC key.
 * @param plaintext - The data to encrypt.
 * @returns Bitwarden cipher string.
 */
function encryptAesCbc256Hmac(
  encKey: Buffer,
  macKey: Buffer,
  plaintext: Buffer,
): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
  cipher.setAutoPadding(false);
  const padded = padPkcs7(plaintext, 16);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final()]);
  const mac = generateMac(macKey, iv, ciphertext);
  return `2.${iv.toString('base64')}|${ciphertext.toString('base64')}|${mac.toString('base64')}`;
}

/**
 * Options for generating an encrypted Bitwarden export.
 *
 * @property kdfType - KDF algorithm (0 = PBKDF2). Only PBKDF2 is supported for generation.
 * @property iterations - Number of KDF iterations (default: 600,000).
 * @property memory - Argon2id memory cost in MB (unused for PBKDF2).
 * @property parallelism - Argon2id parallelism (unused for PBKDF2).
 * @property salt - 16-byte random salt. Generated if not provided.
 */
export interface GenerateEncryptedExportOptions {
  kdfType?: number;
  iterations?: number;
  memory?: number;
  parallelism?: number;
  salt?: Buffer;
}

/**
 * Generate an encrypted Bitwarden vault export from plaintext JSON.
 *
 * Derives the master key from the password using PBKDF2, stretches it
 * to enc/mac keys, generates a UUID validation token, encrypts the vault
 * payload, and returns the full encrypted export JSON.
 *
 * @param vaultJson - Plaintext vault JSON string to encrypt.
 * @param password - User-provided export password.
 * @param opts - Optional KDF and encryption parameters.
 * @returns JSON string of the encrypted Bitwarden export.
 *
 * @security Zeroes intermediate key material (password, masterKey, encKey, macKey).
 *   The returned JSON is safe to store — it's encrypted.
 *   Only PBKDF2 (kdfType=0) is supported for generation.
 */
export function generateEncryptedExport(
  vaultJson: string,
  password: string,
  opts: GenerateEncryptedExportOptions = {},
): string {
  const {
    kdfType = 0,
    iterations = 600000,
    salt = crypto.randomBytes(16),
  } = opts;

  const saltB64 = salt.toString('base64');
  const saltBytes = Buffer.from(saltB64, 'utf-8');
  const passwordBuf = Buffer.from(password, 'utf-8');

  let masterKey: Buffer;
  if (kdfType === 0) {
    masterKey = crypto.pbkdf2Sync(passwordBuf, saltBytes, iterations, 32, 'sha256');
  } else {
    throw new Error(`Unsupported kdfType for generation: ${kdfType}. Only 0 (PBKDF2) is supported.`);
  }
  passwordBuf.fill(0);

  const { encKey, macKey } = stretchKey(masterKey);
  masterKey.fill(0);

  const validationUuid = crypto.randomUUID();
  const encKeyValidation = encryptAesCbc256Hmac(encKey, macKey, Buffer.from(validationUuid, 'utf-8'));

  const data = encryptAesCbc256Hmac(encKey, macKey, Buffer.from(vaultJson, 'utf-8'));

  encKey.fill(0);
  macKey.fill(0);

  return JSON.stringify({
    encrypted: true,
    passwordProtected: true,
    salt: saltB64,
    kdfType,
    kdfIterations: iterations,
    kdfMemory: null,
    kdfParallelism: null,
    encKeyValidation_DO_NOT_EDIT: encKeyValidation,
    data,
  });
}
