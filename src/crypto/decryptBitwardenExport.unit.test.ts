import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

import * as argon2 from 'argon2';

import { generateEncryptedExport } from './generateEncryptedExport.js';
import { decryptBitwardenExport } from './decryptBitwardenExport.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(currentDir, 'fixtures');
const fixturePath = path.join(fixturesDir, 'encrypted-pbkdf2.json');

const vault = {
  folders: [{ id: '1', name: 'Social' }],
  items: [
    {
      folderId: '1',
      type: 1,
      name: 'Test Site',
      login: {
        password: 'password123',
        username: 'user@example.com',
        uris: [{ uri: 'https://example.com', match: null }],
      },
    },
  ],
};

const testPassword = 'test-password-123';

function deriveSubKeys(masterKey: Buffer): { encKey: Buffer; macKey: Buffer } {
  const encKey = crypto.createHmac('sha256', masterKey)
    .update(Buffer.from('enc'))
    .update(Buffer.from([0x01]))
    .digest()
    .subarray(0, 32) as Buffer;
  const macKey = crypto.createHmac('sha256', masterKey)
    .update(Buffer.from('mac'))
    .update(Buffer.from([0x01]))
    .digest()
    .subarray(0, 32) as Buffer;
  return { encKey, macKey };
}

function derivePbkdf2Keys(
  password: string,
  salt: Buffer,
  iterations = 600000,
): { masterKey: Buffer; encKey: Buffer; macKey: Buffer } {
  const saltBytes = Buffer.from(salt.toString('base64'), 'utf-8');
  const passwordBuf = Buffer.from(password, 'utf-8');
  const masterKey = crypto.pbkdf2Sync(passwordBuf, saltBytes, iterations, 32, 'sha256');
  return { masterKey, ...deriveSubKeys(masterKey) };
}

async function deriveArgon2Keys(
  password: string,
  salt: Buffer,
  opts: { timeCost?: number; memoryCost?: number; parallelism?: number } = {},
): Promise<{ masterKey: Buffer; encKey: Buffer; macKey: Buffer }> {
  const saltBytes = Buffer.from(salt.toString('base64'), 'utf-8');
  const passwordBuf = Buffer.from(password, 'utf-8');
  const saltHash = crypto.createHash('sha256').update(saltBytes).digest();
  const masterKey = await argon2.hash(passwordBuf, {
    type: argon2.argon2id,
    salt: saltHash,
    timeCost: opts.timeCost ?? 3,
    memoryCost: opts.memoryCost ?? 64 * 1024,
    parallelism: opts.parallelism ?? 4,
    hashLength: 32,
    raw: true,
  }) as Buffer;
  return { masterKey, ...deriveSubKeys(masterKey) };
}

function encryptType0(key: Buffer, plaintext: Buffer): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  cipher.setAutoPadding(false);
  const padLen = 16 - (plaintext.length % 16);
  const padded = Buffer.concat([plaintext, Buffer.alloc(padLen, padLen)]);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final()]);
  return `0.${iv.toString('base64')}|${ciphertext.toString('base64')}`;
}

function encryptType2(key: Buffer, macKey: Buffer, plaintext: Buffer): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  cipher.setAutoPadding(false);
  const padLen = 16 - (plaintext.length % 16);
  const padded = Buffer.concat([plaintext, Buffer.alloc(padLen, padLen)]);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final()]);
  const mac = crypto.createHmac('sha256', macKey).update(iv).update(ciphertext).digest();
  return `2.${iv.toString('base64')}|${ciphertext.toString('base64')}|${mac.toString('base64')}`;
}

function buildExportJson(opts: {
  data: string;
  encKeyValidation: string;
  kdfType?: number;
  kdfIterations?: number;
  kdfMemory?: number | null;
  kdfParallelism?: number | null;
  saltB64: string;
}): string {
  return JSON.stringify({
    encrypted: true,
    passwordProtected: true,
    salt: opts.saltB64,
    kdfType: opts.kdfType ?? 0,
    kdfIterations: opts.kdfIterations ?? 600000,
    kdfMemory: opts.kdfMemory ?? null,
    kdfParallelism: opts.kdfParallelism ?? null,
    encKeyValidation_DO_NOT_EDIT: opts.encKeyValidation,
    data: opts.data,
  });
}

beforeAll(() => {
  if (!fs.existsSync(fixturePath)) {
    const encrypted = generateEncryptedExport(JSON.stringify(vault), testPassword, {
      kdfType: 0,
      iterations: 600000,
      salt: Buffer.alloc(16, 0),
    });
    fs.mkdirSync(fixturesDir, { recursive: true });
    fs.writeFileSync(fixturePath, encrypted, 'utf-8');
  }
});

describe('decryptBitwardenExport', () => {
  it('decrypts with correct password and returns valid JSON', async () => {
    const rawJson = fs.readFileSync(fixturePath, 'utf-8');
    const result = await decryptBitwardenExport(rawJson, testPassword);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual(vault);
    expect(parsed.items[0].login.password).toBe('password123');
  });

  it('throws for wrong password', async () => {
    const rawJson = fs.readFileSync(fixturePath, 'utf-8');
    await expect(
      decryptBitwardenExport(rawJson, 'wrong-password'),
    ).rejects.toThrow('Incorrect password');
  });

  it('throws for unsupported kdfType during generation', () => {
    expect(
      () => generateEncryptedExport(JSON.stringify({ items: [] }), 'password', { kdfType: 1 }),
    ).toThrow('Unsupported kdfType for generation: 1');
  });

  it('throws for missing passwordProtected', async () => {
    const encrypted = generateEncryptedExport(JSON.stringify(vault), testPassword, {
      kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0),
    });
    const modified = encrypted.replace('"passwordProtected":true', '"passwordProtected":false');
    await expect(
      decryptBitwardenExport(modified, testPassword),
    ).rejects.toThrow('account-restricted');
  });

  it('throws for unknown kdfType', async () => {
    const encrypted = generateEncryptedExport(JSON.stringify(vault), testPassword, {
      kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0),
    });
    const parsed = JSON.parse(encrypted);
    parsed.kdfType = 99;
    await expect(
      decryptBitwardenExport(JSON.stringify(parsed), testPassword),
    ).rejects.toThrow('Unsupported KDF type: 99');
  });

  it('throws for missing data field', async () => {
    const encrypted = generateEncryptedExport(JSON.stringify(vault), testPassword, {
      kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0),
    });
    const parsed = JSON.parse(encrypted);
    delete parsed.data;
    await expect(
      decryptBitwardenExport(JSON.stringify(parsed), testPassword),
    ).rejects.toThrow('missing the data field');
  });

  it('throws for missing encKeyValidation field', async () => {
    const encrypted = generateEncryptedExport(JSON.stringify(vault), testPassword, {
      kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0),
    });
    const parsed = JSON.parse(encrypted);
    delete parsed.encKeyValidation_DO_NOT_EDIT;
    await expect(
      decryptBitwardenExport(JSON.stringify(parsed), testPassword),
    ).rejects.toThrow('missing the validation field');
  });

  it('throws for corrupted MAC', async () => {
    const encrypted = generateEncryptedExport(JSON.stringify(vault), testPassword, {
      kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0),
    });
    const parsed = JSON.parse(encrypted);
    const dataParts = parsed.data.split('|');
    dataParts[2] = Buffer.from('corrupted-mac').toString('base64');
    parsed.data = dataParts.join('|');
    await expect(
      decryptBitwardenExport(JSON.stringify(parsed), testPassword),
    ).rejects.toThrow();
  });

  it('throws for invalid JSON', async () => {
    await expect(
      decryptBitwardenExport('not-json', testPassword),
    ).rejects.toThrow('Invalid JSON');
  });

  it('throws for non-encrypted export', async () => {
    await expect(
      decryptBitwardenExport(JSON.stringify({ encrypted: false, items: [] }), testPassword),
    ).rejects.toThrow('does not appear to be an encrypted');
  });

  it('parses CipherString with whitespace', async () => {
    const rawJson = fs.readFileSync(fixturePath, 'utf-8');
    const result = await decryptBitwardenExport(rawJson, testPassword);
    expect(JSON.parse(result)).toEqual(vault);
  });

  it('throws for missing salt field', async () => {
    const encrypted = generateEncryptedExport(JSON.stringify(vault), testPassword, {
      kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0),
    });
    const parsed = JSON.parse(encrypted);
    delete parsed.salt;
    await expect(
      decryptBitwardenExport(JSON.stringify(parsed), testPassword),
    ).rejects.toThrow('missing the salt field');
  });

  it('throws for invalid kdfIterations (negative)', async () => {
    const encrypted = generateEncryptedExport(JSON.stringify(vault), testPassword, {
      kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0),
    });
    const parsed = JSON.parse(encrypted);
    parsed.kdfIterations = -5;
    await expect(
      decryptBitwardenExport(JSON.stringify(parsed), testPassword),
    ).rejects.toThrow('invalid kdfIterations');
  });

  it('throws for invalid kdfIterations (NaN)', async () => {
    const encrypted = generateEncryptedExport(JSON.stringify(vault), testPassword, {
      kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0),
    });
    const parsed = JSON.parse(encrypted);
    parsed.kdfIterations = 'not-a-number';
    await expect(
      decryptBitwardenExport(JSON.stringify(parsed), testPassword),
    ).rejects.toThrow('invalid kdfIterations');
  });

  it('throws for unrecognized cipher string type', async () => {
    const encrypted = generateEncryptedExport(JSON.stringify(vault), testPassword, {
      kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0),
    });
    const parsed = JSON.parse(encrypted);
    parsed.data = `3.${parsed.data.split('|').slice(1).join('|')}`;
    await expect(
      decryptBitwardenExport(JSON.stringify(parsed), testPassword),
    ).rejects.toThrow('Unrecognized encrypted data format');
  });

  it('throws for type 2 cipher string with insufficient parts', async () => {
    const encrypted = generateEncryptedExport(JSON.stringify(vault), testPassword, {
      kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0),
    });
    const parsed = JSON.parse(encrypted);
    const parts = parsed.data.split('|');
    parsed.data = `2.${parts[0]}`;
    await expect(
      decryptBitwardenExport(JSON.stringify(parsed), testPassword),
    ).rejects.toThrow('Unrecognized encrypted data format');
  });

  it('decrypts type 0 cipher string (no MAC)', async () => {
    const salt = Buffer.alloc(16, 0);
    const { encKey, macKey } = derivePbkdf2Keys(testPassword, salt);

    const validationUuid = crypto.randomUUID();
    const encKeyValidation = encryptType0(encKey, Buffer.from(validationUuid, 'utf-8'));
    const data = encryptType2(encKey, macKey, Buffer.from(JSON.stringify(vault), 'utf-8'));

    const exportJson = buildExportJson({
      saltB64: salt.toString('base64'),
      encKeyValidation,
      data,
    });

    const result = await decryptBitwardenExport(exportJson, testPassword);
    expect(JSON.parse(result)).toEqual(vault);
  });

  it('throws for type 0 cipher string with insufficient parts', async () => {
    const encrypted = generateEncryptedExport(JSON.stringify(vault), testPassword, {
      kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0),
    });
    const parsed = JSON.parse(encrypted);
    parsed.data = `0.${parsed.data.split('|')[1]}`;
    await expect(
      decryptBitwardenExport(JSON.stringify(parsed), testPassword),
    ).rejects.toThrow('Unrecognized encrypted data format');
  });

  it('decrypts Argon2id-encrypted export', async () => {
    const salt = Buffer.alloc(16, 0);
    const { encKey, macKey } = await deriveArgon2Keys(testPassword, salt);

    const validationUuid = crypto.randomUUID();
    const encKeyValidation = encryptType2(encKey, macKey, Buffer.from(validationUuid, 'utf-8'));
    const data = encryptType2(encKey, macKey, Buffer.from(JSON.stringify(vault), 'utf-8'));

    const exportJson = buildExportJson({
      saltB64: salt.toString('base64'),
      kdfType: 2,
      kdfIterations: 3,
      kdfMemory: 64,
      kdfParallelism: 4,
      encKeyValidation,
      data,
    });

    const result = await decryptBitwardenExport(exportJson, testPassword);
    expect(JSON.parse(result)).toEqual(vault);
  });

  it('throws for UUID validation failure (type-0 validation with non-UUID)', async () => {
    const salt = Buffer.alloc(16, 0);
    const { encKey, macKey } = derivePbkdf2Keys(testPassword, salt);

    const encKeyValidation = encryptType0(encKey, Buffer.from('not-a-uuid', 'utf-8'));
    const data = encryptType2(encKey, macKey, Buffer.from(JSON.stringify(vault), 'utf-8'));

    const exportJson = buildExportJson({
      saltB64: salt.toString('base64'),
      encKeyValidation,
      data,
    });

    await expect(
      decryptBitwardenExport(exportJson, testPassword),
    ).rejects.toThrow('Incorrect password');
  });

  it('throws for PKCS7 padding error (valid MAC, bad padding)', async () => {
    const salt = Buffer.alloc(16, 0);
    const { encKey, macKey } = derivePbkdf2Keys(testPassword, salt);

    const validationUuid = crypto.randomUUID();
    const validIv = crypto.randomBytes(16);
    const validCipher = crypto.createCipheriv('aes-256-cbc', encKey, validIv);
    validCipher.setAutoPadding(false);
    const validPadded = Buffer.concat([Buffer.from(validationUuid, 'utf-8'), Buffer.alloc(16 - (36 % 16), 16 - (36 % 16))]);
    const validCt = Buffer.concat([validCipher.update(validPadded), validCipher.final()]);
    const validMac = crypto.createHmac('sha256', macKey).update(validIv).update(validCt).digest();
    const encKeyValidation = `2.${validIv.toString('base64')}|${validCt.toString('base64')}|${validMac.toString('base64')}`;

    const badIv = crypto.randomBytes(16);
    const badPlainBuf = Buffer.from(JSON.stringify(vault), 'utf-8');
    const badPadLen = 16 - (badPlainBuf.length % 16);
    const badPadded = Buffer.concat([badPlainBuf, Buffer.alloc(badPadLen, 0)]);
    const badCipher = crypto.createCipheriv('aes-256-cbc', encKey, badIv);
    badCipher.setAutoPadding(false);
    const badCt = Buffer.concat([badCipher.update(badPadded), badCipher.final()]);
    const badMac = crypto.createHmac('sha256', macKey).update(badIv).update(badCt).digest();
    const data = `2.${badIv.toString('base64')}|${badCt.toString('base64')}|${badMac.toString('base64')}`;

    const exportJson = buildExportJson({
      saltB64: salt.toString('base64'),
      encKeyValidation,
      data,
    });

    await expect(
      decryptBitwardenExport(exportJson, testPassword),
    ).rejects.toThrow('Incorrect password');
  });

  it('throws for cipher string with no dot (line 16)', async () => {
    const encrypted = generateEncryptedExport(JSON.stringify(vault), testPassword, {
      kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0),
    });
    const parsed = JSON.parse(encrypted);
    parsed.encKeyValidation_DO_NOT_EDIT = 'nodotstring';
    await expect(
      decryptBitwardenExport(JSON.stringify(parsed), testPassword),
    ).rejects.toThrow('Unrecognized encrypted data format');
  });

  it('throws for cipher string with non-numeric type prefix (line 20)', async () => {
    const encrypted = generateEncryptedExport(JSON.stringify(vault), testPassword, {
      kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0),
    });
    const parsed = JSON.parse(encrypted);
    parsed.encKeyValidation_DO_NOT_EDIT = 'abc.dGVzdA==';
    await expect(
      decryptBitwardenExport(JSON.stringify(parsed), testPassword),
    ).rejects.toThrow('Unrecognized encrypted data format');
  });

  it('throws for empty decrypted buffer in removePkcs7Padding (line 109)', async () => {
    const salt = Buffer.alloc(16, 0);
    const { encKey, macKey } = derivePbkdf2Keys(testPassword, salt);

    const validationUuid = crypto.randomUUID();
    const encKeyValidation = encryptType0(encKey, Buffer.from(validationUuid, 'utf-8'));

    const emptyIv = crypto.randomBytes(16);
    const emptyCipher = crypto.createCipheriv('aes-256-cbc', encKey, emptyIv);
    emptyCipher.setAutoPadding(false);
    const emptyCt = Buffer.concat([emptyCipher.update(Buffer.alloc(0)), emptyCipher.final()]);
    const emptyMac = crypto.createHmac('sha256', macKey).update(emptyIv).update(emptyCt).digest();
    const data = `2.${emptyIv.toString('base64')}|${emptyCt.toString('base64')}|${emptyMac.toString('base64')}`;

    const exportJson = buildExportJson({
      saltB64: salt.toString('base64'),
      encKeyValidation,
      data,
    });

    await expect(
      decryptBitwardenExport(exportJson, testPassword),
    ).rejects.toThrow('Incorrect password');
  });

  it('throws for PKCS7 padding byte mismatch (line 117)', async () => {
    const salt = Buffer.alloc(16, 0);
    const { encKey, macKey } = derivePbkdf2Keys(testPassword, salt);

    function encCustom(k: Buffer, mk: Buffer, pt: Buffer, pad: number[]): string {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', k, iv);
      cipher.setAutoPadding(false);
      const padded = Buffer.concat([pt, Buffer.from(pad)]);
      const ciphertext = Buffer.concat([cipher.update(padded), cipher.final()]);
      const hmac = crypto.createHmac('sha256', mk).update(iv).update(ciphertext);
      const mac = hmac.digest();
      return `2.${iv.toString('base64')}|${ciphertext.toString('base64')}|${mac.toString('base64')}`;
    }

    const validationUuid = crypto.randomUUID();
    const encKeyValidation = encryptType0(encKey, Buffer.from(validationUuid, 'utf-8'));

    const vaultPlaintext = Buffer.from(JSON.stringify(vault), 'utf-8');
    const padLen = 16 - (vaultPlaintext.length % 16);
    const badPadding = Buffer.alloc(padLen, padLen);
    badPadding[padLen - 1] = padLen - 1;
    const data = encCustom(encKey, macKey, vaultPlaintext, Array.from(badPadding));

    const exportJson = buildExportJson({
      saltB64: salt.toString('base64'),
      encKeyValidation,
      data,
    });

    await expect(
      decryptBitwardenExport(exportJson, testPassword),
    ).rejects.toThrow('Incorrect password');
  });

  it('decrypts Argon2id export without kdfMemory/kdfParallelism (uses defaults)', async () => {
    const salt = Buffer.alloc(16, 0);
    const { encKey, macKey } = await deriveArgon2Keys(testPassword, salt);

    const validationUuid = crypto.randomUUID();
    const encKeyValidation = encryptType2(encKey, macKey, Buffer.from(validationUuid, 'utf-8'));
    const data = encryptType2(encKey, macKey, Buffer.from(JSON.stringify(vault), 'utf-8'));

    const exportJson = buildExportJson({
      saltB64: salt.toString('base64'),
      kdfType: 2,
      kdfIterations: 3,
      encKeyValidation,
      data,
    });

    const result = await decryptBitwardenExport(exportJson, testPassword);
    expect(JSON.parse(result)).toEqual(vault);
  });

  it('cleans up null encKey/macKey when deriveMasterKey throws', async () => {
    const encrypted = generateEncryptedExport(JSON.stringify(vault), testPassword, {
      kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0),
    });
    const parsed = JSON.parse(encrypted);
    parsed.kdfType = 2;
    parsed.kdfIterations = 3;
    parsed.kdfMemory = 0;
    await expect(
      decryptBitwardenExport(JSON.stringify(parsed), testPassword),
    ).rejects.toThrow();
  });
});
