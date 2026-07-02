import path from 'path';
import fs from 'fs';
import os from 'os';
import writeJsonOutputFile from '../src/handlers/json/output';
import type { hashWithLeaksAndPasswordObjects, passwordObject } from '../src/interfaces/types';

const makeSampleData = (): hashWithLeaksAndPasswordObjects[] => [
  {
    hash: 'ABC123',
    leaks: 1000,
    readableLeaks: '1 000',
    compactLeaks: '1 K',
    passwordObjects: [
      { login_password: 'pass1', name: 'site1' },
    ],
  },
];

describe('JSON output handler', () => {
  it('writes data to JSON file correctly', async () => {
    const tmpFile = path.join(os.tmpdir(), `test-output-${Date.now()}.json`);
    try {
      await writeJsonOutputFile(tmpFile, makeSampleData());
      const content = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
      expect(content).toHaveLength(1);
      expect(content[0].hash).toBe('ABC123');
      expect(content[0].leaks).toBe(1000);
      expect(content[0].passwordObjects[0].login_password).toBe('pass1');
      expect(content[0].passwordObjects[0].login_password_hash).toBe('ABC123');
      expect(content[0].passwordObjects[0].login_password_leaks).toBe(1000);
      expect(content[0].passwordObjects[0].login_password_readable_leaks).toBe('1 000');
      expect(content[0].passwordObjects[0].login_password_compact_leaks).toBe('1 K');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  it('strips null/undefined/empty from nested objects', async () => {
    const data: hashWithLeaksAndPasswordObjects[] = [{
      hash: 'A',
      leaks: 1,
      readableLeaks: '1',
      compactLeaks: '1',
      passwordObjects: [
        {
          login: {
            password: 'p1', username: null, totp: '', uris: null,
          },
          name: 'Site',
          notes: null,
          archivedDate: undefined,
          fields: [],
          passwordHistory: [],
        } as unknown as passwordObject,
        {
          login: { username: null },
          name: null,
        } as unknown as passwordObject,
      ],
    }];

    const tmpFile = path.join(os.tmpdir(), `test-output-strip-${Date.now()}.json`);
    try {
      await writeJsonOutputFile(tmpFile, data);
      const content = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
      expect(content).toHaveLength(1);
      const objs = content[0].passwordObjects;
      expect(objs).toHaveLength(2);

      const obj = objs[0];
      expect(obj.login.password).toBe('p1');
      expect(obj.login.username).toBeUndefined();
      expect(obj.login.totp).toBeUndefined();
      expect(obj.notes).toBeUndefined();
      expect(obj.archivedDate).toBeUndefined();
      expect(obj.fields).toBeUndefined();
      expect(obj.passwordHistory).toBeUndefined();
      expect(obj.login_password_hash).toBe('A');
      expect(obj.login_password_leaks).toBe(1);
      expect(obj.login_password_readable_leaks).toBe('1');
      expect(obj.login_password_compact_leaks).toBe('1');

      const obj2 = objs[1];
      expect(obj2.login).toBeUndefined();
      expect(obj2.name).toBeUndefined();
      expect(obj2.login_password_hash).toBe('A');
      expect(obj2.login_password_leaks).toBe(1);
      expect(obj2.login_password_readable_leaks).toBe('1');
      expect(obj2.login_password_compact_leaks).toBe('1');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  it('handles empty data array', async () => {
    const tmpFile = path.join(os.tmpdir(), `test-output-empty-${Date.now()}.json`);
    try {
      await writeJsonOutputFile(tmpFile, []);
      const content = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
      expect(content).toEqual([]);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });
});
