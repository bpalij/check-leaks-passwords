import path from 'path';
import fs from 'fs';
import os from 'os';
import writePreparedDataToCsv from '../src/handlers/csv/output';
import type { hashWithLeaksAndPasswordObjects } from '../src/interfaces/types';

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
  it('writes data to CSV file correctly', async () => {
    const tmpFile = path.join(os.tmpdir(), `test-output-${Date.now()}.csv`);
    try {
      await writePreparedDataToCsv(tmpFile, makeSampleData());
      const content = fs.readFileSync(tmpFile, 'utf-8');
      expect(content).toContain('login_password,name,login_password_hash,login_password_leaks,login_password_readable_leaks');
      expect(content).toContain('pass1,site1,ABC123,1000,1 000');
      expect(content).toContain('pass2,site2,ABC123,1000,1 000');
      expect(content).toContain('pass3,site3,DEF456,500,500');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  it('handles non-string values by serializing them', async () => {
    const tmpFile = path.join(os.tmpdir(), `test-output-nonstring-${Date.now()}.csv`);
    try {
      await writePreparedDataToCsv(tmpFile, makeDataWithNonStringValues());
      const content = fs.readFileSync(tmpFile, 'utf-8');
      expect(content).toContain('favorite,type');
      expect(content).toContain('true');
      expect(content).toContain('1');
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
