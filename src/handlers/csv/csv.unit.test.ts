import path from 'path';
import fs from 'fs';
import os from 'os';

import {
  describe, it, expect,
} from 'vitest';

import {
  readCsvInputFile, validateSinglePasswordObject,
} from './read.js';
import { writePreparedDataToCsv } from './write.js';
import type {
  FlatPasswordObject, HashWithLeaksAndPasswordObjects, PasswordObject,
} from '../../types.js';
import { FIXTURES_DIR } from '../../../tests/helpers/fixturesDir.js';

const fixturesDir = FIXTURES_DIR;

describe('CSV input handler', () => {
  it('reads a valid CSV file', async () => {
    const result = await readCsvInputFile(path.join(fixturesDir, 'sample.csv')) as unknown as FlatPasswordObject[];
    expect(result).toHaveLength(3);
    expect(result[0].login_password).toBe('password123');
    expect(result[0].login_username).toBe('user1@example.com');
    expect((result[0] as Record<string, unknown>).folderName).toBe('Social');
    expect(result[1].login_password).toBe('letmein');
    expect((result[1] as Record<string, unknown>).folderName).toBe('Work');
    expect(result[2].login_password).toBe('P@ssw0rd!');
    expect((result[2] as Record<string, unknown>).folderName).toBe('Finance');
  });

  it('filters out rows with empty passwords', async () => {
    const result = await readCsvInputFile(path.join(fixturesDir, 'empty.csv'));
    expect(result).toHaveLength(0);
  });

  it('rejects on rows with inconsistent column counts', async () => {
    await expect(
      readCsvInputFile(path.join(fixturesDir, 'malformed.csv')),
    ).rejects.toThrow('column header mismatch');
  });

  it('handles invalid date strings without crashing', async () => {
    const result = await readCsvInputFile(path.join(fixturesDir, 'csv-bad-date.csv'));
    expect(result).toHaveLength(1);
    expect(result[0].passwordAgeDays).toBeUndefined();
  });

  it('handles unknown type and reprompt values as undefined with uriCount', async () => {
    const result = await readCsvInputFile(path.join(fixturesDir, 'csv-edge-enrichments.csv'));
    expect(result).toHaveLength(2);
    expect(result[0].typeLabel).toBeUndefined();
    expect(result[0].repromptLabel).toBeUndefined();
    expect(result[0].uriCount).toBe(1);
    expect(result[1].type).toBe('custom');
    expect(result[1].typeLabel).toBeUndefined();
  });

  it('aggregates multiple login_uri columns into login_uris JSON array', async () => {
    const result = await readCsvInputFile(path.join(fixturesDir, 'csv-multi-uri.csv'));
    expect(result).toHaveLength(2);
    expect((result[0] as Record<string, unknown>).login_uris).toEqual([
      'https://example.com',
      'https://x.com',
      'https://y.com',
    ]);
    expect((result[0] as Record<string, unknown>).uriCount).toBe(3);
    expect((result[1] as Record<string, unknown>).login_uris).toBeUndefined();
    expect((result[1] as Record<string, unknown>).uriCount).toBeUndefined();
  });

  it('skips rows when CSV header lacks login_password', async () => {
    const result = await readCsvInputFile(path.join(fixturesDir, 'csv-no-password.csv'));
    expect(Array.isArray(result)).toBe(true);
  });

  it('computes enrichments from CSV columns', async () => {
    const result = await readCsvInputFile(path.join(fixturesDir, 'csv-with-enrichments.csv'));
    expect(result).toHaveLength(2);
    expect(result[0].passwordAgeDays).toBeGreaterThan(0);
    expect(result[0].typeLabel).toBe('Login');
    expect(result[0].repromptLabel).toBe('None');
    expect(result[0].hasTotp).toBe(true);
    expect(result[0].uriCount).toBeUndefined();
    expect(result[1].passwordAgeDays).toBeGreaterThan(0);
    expect(result[1].typeLabel).toBe('Identity');
    expect(result[1].repromptLabel).toBe('Require master password');
    expect(result[1].hasTotp).toBe(false);
    expect(result[0].favorite).toBe(true);
    expect(result[1].favorite).toBe(false);
  });

  it('uses collections column as fallback for folderName when folder is missing', async () => {
    const result = await readCsvInputFile(path.join(fixturesDir, 'csv-collections.csv'));
    expect(result).toHaveLength(2);
    expect((result[0] as Record<string, unknown>).folderName).toBe('WorkStuff');
    expect((result[1] as Record<string, unknown>).folderName).toBeUndefined();
  });
});

describe('validateSinglePasswordObject', () => {
  it('returns true for a valid password object', () => {
    expect(validateSinglePasswordObject({ login_password: 'pass' })).toBe(true);
  });

  it('returns true with null and number values', () => {
    expect(validateSinglePasswordObject({ login_password: 'pass', extra: null, count: 5 })).toBe(true);
  });

  it('returns false for null', () => {
    expect(validateSinglePasswordObject(null)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(validateSinglePasswordObject('hello')).toBe(false);
  });

  it('returns false for a number', () => {
    expect(validateSinglePasswordObject(42)).toBe(false);
  });

  it('returns false when login_password is missing', () => {
    expect(validateSinglePasswordObject({ name: 'test' })).toBe(false);
  });

  it('returns false when login_password is not a string', () => {
    expect(validateSinglePasswordObject({ login_password: 123 })).toBe(false);
  });

  it('returns false for a nested object value', () => {
    expect(validateSinglePasswordObject({ login_password: 'pass', nested: { x: 1 } })).toBe(false);
  });

  it('returns false for an array value', () => {
    expect(validateSinglePasswordObject({ login_password: 'pass', items: [1, 2] })).toBe(false);
  });

  it('accepts a valid object with login_password string', () => {
    expect(validateSinglePasswordObject({ login_password: 'mypass', name: 'test' })).toBe(true);
  });

  it('accepts numeric values', () => {
    expect(validateSinglePasswordObject({ login_password: 'pass', type: 1 })).toBe(true);
  });

  it('accepts null values', () => {
    expect(validateSinglePasswordObject({ login_password: 'pass', notes: null })).toBe(true);
  });

  it('accepts undefined values', () => {
    expect(validateSinglePasswordObject({ login_password: 'pass', extra: undefined })).toBe(true);
  });

  it('rejects objects with no login_password', () => {
    expect(validateSinglePasswordObject({ name: 'test' })).toBe(false);
  });

  it('rejects non-object values', () => {
    expect(validateSinglePasswordObject(null)).toBe(false);
    expect(validateSinglePasswordObject(undefined)).toBe(false);
    expect(validateSinglePasswordObject('string')).toBe(false);
    expect(validateSinglePasswordObject(42)).toBe(false);
  });

  it('rejects objects with invalid value types', () => {
    expect(validateSinglePasswordObject({
      login_password: 'pass',
      extra: { nested: 'object' },
    })).toBe(false);
  });
});

const makeSampleData = (): HashWithLeaksAndPasswordObjects[] => [
  {
    hash: 'ABC123',
    leaks: 1000,
    passwordObjects: [{ login_password: 'pass1', name: 'site1' }, { login_password: 'pass2', name: 'site2' }],
  },
  {
    hash: 'DEF456',
    leaks: 500,
    passwordObjects: [{ login_password: 'pass3', name: 'site3', extra: undefined }],
  },
];

const makeDataWithNonStringValues = (): HashWithLeaksAndPasswordObjects[] => [
  {
    hash: 'ABC123',
    leaks: 1000,
    passwordObjects: [{ login_password: 'pass1', favorite: true, type: 1 }],
  },
];

describe('CSV output handler', () => {
  it('rejects when write stream emits error', async () => {
    const dirPath = path.join(os.tmpdir(), `csv-err-${Date.now()}`);
    fs.mkdirSync(dirPath, { recursive: true });
    try {
      await expect(
        writePreparedDataToCsv(dirPath, makeSampleData(), { includeSecrets: true }),
      ).rejects.toThrow();
    } finally {
      try { fs.rmdirSync(dirPath); } catch { /* ignore */ }
    }
  });

  it('writes data to CSV file correctly', async () => {
    const tmpFile = path.join(os.tmpdir(), `test-output-${Date.now()}.csv`);
    try {
      await writePreparedDataToCsv(tmpFile, makeSampleData(), { includeSecrets: true });
      const content = fs.readFileSync(tmpFile, 'utf-8');
      expect(content).toContain('name,login_password,login_password_hash,login_password_leaks,login_password_readable_leaks,login_password_compact_leaks');
      expect(content).toContain('site1,pass1,ABC123,1000,1 000,1K');
      expect(content).toContain('site2,pass2,ABC123,1000,1 000,1K');
      expect(content).toContain('site3,pass3,DEF456,500,500,500');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  it('handles non-string values by serializing them', async () => {
    const tmpFile = path.join(os.tmpdir(), `test-output-nonstring-${Date.now()}.csv`);
    try {
      await writePreparedDataToCsv(
        tmpFile,
        makeDataWithNonStringValues(),
        { includeSecrets: true },
      );
      const content = fs.readFileSync(tmpFile, 'utf-8');
      expect(content).toContain('type');
      expect(content).toContain('favorite');
      expect(content).toContain('true');
      expect(content).toContain('1');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  it('serialises flat objects without login key via JSON.stringify', async () => {
    const flatData: HashWithLeaksAndPasswordObjects[] = [
      {
        hash: 'DEF456',
        leaks: 0,
        passwordObjects: [
          {
            login_password: 'p1',
            login_username: 'u1',
            customFields: [{ name: 'cf1', value: 'v1' }],
          } as unknown as PasswordObject,
        ],
      },
    ];

    const tmpFile = path.join(os.tmpdir(), `test-output-flat-${Date.now()}.csv`);
    try {
      await writePreparedDataToCsv(tmpFile, flatData, { includeSecrets: true });
      const content = fs.readFileSync(tmpFile, 'utf-8');
      expect(content).toContain('login_password');
      expect(content).toContain('customFields');
      expect(content).toContain('cf1');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  it('flattens nested objects and serializes complex values', async () => {
    const nestedData: HashWithLeaksAndPasswordObjects[] = [
      {
        hash: 'ABC123',
        leaks: 1000,
        passwordObjects: [
          {
            login: {
              password: 'p1',
              username: 'u1',
              uris: [
                { uri: 'https://x.com' },
                { uri: null },
                {},
              ],
              totp: 'otpauth://totp/example',
              passwordRevisionDate: 1705315200000,
              fido2Credentials: [{ credentialId: 'abc' }],
            },
            folderName: 'FolderA',
            name: 'Site A',
            fields: [{ name: 'f1', value: 'v1' }],
          } as unknown as PasswordObject,
        ],
      },
    ];

    const tmpFile = path.join(os.tmpdir(), `test-output-nested-${Date.now()}.csv`);
    try {
      await writePreparedDataToCsv(tmpFile, nestedData, { includeSecrets: true });
      const content = fs.readFileSync(tmpFile, 'utf-8');
      expect(content).toContain('login_password');
      expect(content).toContain('p1');
      expect(content).toContain('folderName');
      expect(content).toContain('FolderA');
      expect(content).toContain('login_username');
      expect(content).toContain('u1');
      expect(content).toContain('login_uris');
      expect(content).toContain('https://x.com');
      expect(content).toContain('login_totp');
      expect(content).toContain('login_fido2Credentials');
      expect(content).toContain('login_passwordRevisionDate');
      expect(content).toContain('1705315200000');
      expect(content).toContain('fields');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  it('handles empty data array', async () => {
    const tmpFile = path.join(os.tmpdir(), `test-output-empty-${Date.now()}.csv`);
    try {
      await writePreparedDataToCsv(tmpFile, [], { includeSecrets: true });
      const content = fs.readFileSync(tmpFile, 'utf-8');
      expect(content.trim()).toBe('');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });
});

describe('CSV output secure-by-default', () => {
  it('strips passwords by default when includeSecrets is false', async () => {
    const data: HashWithLeaksAndPasswordObjects[] = [
      {
        hash: 'ABC123',
        leaks: 1000,
        passwordObjects: [{ login_password: 'pass1', name: 'site1' }],
      },
    ];
    const tmpFile = path.join(os.tmpdir(), `test-csv-secure-${Date.now()}.csv`);
    try {
      await writePreparedDataToCsv(tmpFile, data);
      const content = fs.readFileSync(tmpFile, 'utf-8');
      expect(content).not.toContain('pass1');
      expect(content).toContain('site1');
      expect(content).toContain('ABC123');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  it('includes passwords when includeSecrets is true', async () => {
    const data: HashWithLeaksAndPasswordObjects[] = [
      {
        hash: 'ABC123',
        leaks: 1000,
        passwordObjects: [{ login_password: 'pass1', name: 'site1' }],
      },
    ];
    const tmpFile = path.join(os.tmpdir(), `test-csv-insecure-${Date.now()}.csv`);
    try {
      await writePreparedDataToCsv(tmpFile, data, { includeSecrets: true });
      const content = fs.readFileSync(tmpFile, 'utf-8');
      expect(content).toContain('pass1');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  it('strips nested login secrets by default', async () => {
    const data: HashWithLeaksAndPasswordObjects[] = [
      {
        hash: 'ABC123',
        leaks: 1000,
        passwordObjects: [
          {
            login: {
              password: 'secret',
              totp: 'otpauth://totp/example',
              fido2Credentials: [{ id: 'abc' }],
              username: 'user',
              uris: [{ uri: 'https://example.com' }],
            },
            name: 'Site',
            passwordHistory: [{ password: 'old' }],
          } as unknown as PasswordObject,
        ],
      },
    ];
    const tmpFile = path.join(os.tmpdir(), `test-csv-nested-secure-${Date.now()}.csv`);
    try {
      await writePreparedDataToCsv(tmpFile, data);
      const content = fs.readFileSync(tmpFile, 'utf-8');
      expect(content).not.toContain('secret');
      expect(content).not.toContain('otpauth');
      expect(content).not.toContain('passwordHistory');
      expect(content).toContain('user');
      expect(content).toContain('https://example.com');
      expect(content).toContain('Site');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });
});
