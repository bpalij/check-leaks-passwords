import path from 'path';
import fs from 'fs';
import os from 'os';
import writePreparedDataToCsv from '../src/handlers/csv/output';
import type { hashWithLeaksAndPasswordObjects, passwordObject } from '../src/interfaces/types';

const makeSampleData = (): hashWithLeaksAndPasswordObjects[] => [
  {
    hash: 'ABC123',
    leaks: 1000,
    readableLeaks: '1 000',
    passwordObjects: [
      { login_password: 'pass1', name: 'site1' },
      { login_password: 'pass2', name: 'site2' },
    ],
  },
  {
    hash: 'DEF456',
    leaks: 500,
    readableLeaks: '500',
    passwordObjects: [
      { login_password: 'pass3', name: 'site3', extra: undefined },
    ],
  },
];

const makeDataWithNonStringValues = (): hashWithLeaksAndPasswordObjects[] => [
  {
    hash: 'ABC123',
    leaks: 1000,
    readableLeaks: '1 000',
    passwordObjects: [
      { login_password: 'pass1', favorite: true, type: 1 },
    ],
  },
];

describe('CSV output handler', () => {
  it('rejects when write fails', async () => {
    const badPath = path.join(os.tmpdir(), 'no-such-dir', `fail-${Date.now()}.csv`);
    await expect(writePreparedDataToCsv(badPath, makeSampleData())).rejects.toThrow();
  });

  it('writes data to CSV file correctly', async () => {
    const tmpFile = path.join(os.tmpdir(), `test-output-${Date.now()}.csv`);
    try {
      await writePreparedDataToCsv(tmpFile, makeSampleData());
      const content = fs.readFileSync(tmpFile, 'utf-8');
      expect(content).toContain('name,login_password,login_password_hash,login_password_leaks,login_password_readable_leaks');
      expect(content).toContain('site1,pass1,ABC123,1000,1 000');
      expect(content).toContain('site2,pass2,ABC123,1000,1 000');
      expect(content).toContain('site3,pass3,DEF456,500,500');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  it('handles non-string values by serializing them', async () => {
    const tmpFile = path.join(os.tmpdir(), `test-output-nonstring-${Date.now()}.csv`);
    try {
      await writePreparedDataToCsv(tmpFile, makeDataWithNonStringValues());
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
    const flatData: hashWithLeaksAndPasswordObjects[] = [
      {
        hash: 'DEF456',
        leaks: 0,
        readableLeaks: '0',
        passwordObjects: [
          {
            login_password: 'p1',
            login_username: 'u1',
            customFields: [{ name: 'cf1', value: 'v1' }],
          } as unknown as passwordObject,
        ],
      },
    ];

    const tmpFile = path.join(os.tmpdir(), `test-output-flat-${Date.now()}.csv`);
    try {
      await writePreparedDataToCsv(tmpFile, flatData);
      const content = fs.readFileSync(tmpFile, 'utf-8');
      expect(content).toContain('login_password');
      expect(content).toContain('customFields');
      expect(content).toContain('cf1');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  it('flattens nested objects and serializes complex values', async () => {
    const nestedData: hashWithLeaksAndPasswordObjects[] = [
      {
        hash: 'ABC123',
        leaks: 1000,
        readableLeaks: '1 000',
        passwordObjects: [
          {
            login: {
              password: 'p1',
              username: 'u1',
              uris: [{ uri: 'https://x.com' }, { uri: null }, {}],
              totp: 'otpauth://totp/example',
              passwordRevisionDate: 1705315200000,
              fido2Credentials: [{ credentialId: 'abc' }],
            },
            folderName: 'FolderA',
            name: 'Site A',
            fields: [{ name: 'f1', value: 'v1' }],
          } as unknown as passwordObject,
        ],
      },
    ];

    const tmpFile = path.join(os.tmpdir(), `test-output-nested-${Date.now()}.csv`);
    try {
      await writePreparedDataToCsv(tmpFile, nestedData);
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
      await writePreparedDataToCsv(tmpFile, []);
      const content = fs.readFileSync(tmpFile, 'utf-8');
      expect(content.trim()).toBe('');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });
});
