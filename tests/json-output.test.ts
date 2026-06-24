import path from 'path';
import fs from 'fs';
import os from 'os';
import writeJsonOutputFile from '../src/handlers/json/output';
import type { hashWithLeaksAndPasswordObjects } from '../src/interfaces/types';

const makeSampleData = (): hashWithLeaksAndPasswordObjects[] => [
  {
    hash: 'ABC123',
    leaks: 1000,
    readableLeaks: '1 000',
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
