import path from 'path';
import fs from 'fs';
import os from 'os';
import processSingleFile from '../src/helpers/processSingleFile';
import type { passwordObject } from '../src/interfaces/types';

const fixturesDir = path.resolve(__dirname, 'fixtures');

describe('processSingleFile', () => {
  const makeMap = (hash: string, objs: passwordObject[] = [{ login_password: 'pass' }]) => {
    const map = new Map<string, passwordObject[]>();
    map.set(hash, objs);
    return map;
  };

  it('returns matching hashes with leak counts', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const result = await processSingleFile(
      map,
      path.join(fixturesDir, 'sample-hashes.txt'),
      'ascii',
    );
    expect(result).toHaveLength(1);
    expect(result[0].hash).toBe('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    expect(result[0].leaks).toBe(1000);
    expect(result[0].readableLeaks).toBe('1 000');
  });

  it('returns empty array when no hashes match', async () => {
    const map = makeMap('NONEXISTENTHASH000000000000000000000000000');
    const result = await processSingleFile(
      map,
      path.join(fixturesDir, 'sample-hashes.txt'),
      'ascii',
    );
    expect(result).toHaveLength(0);
  });

  it('rejects on invalid line in hashes file', async () => {
    const map = makeMap('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
    await expect(
      processSingleFile(
        map,
        path.join(fixturesDir, 'invalid-hashes.txt'),
        'ascii',
      ),
    ).rejects.toThrow('Invalid leak count');
  });

  it('returns empty array for empty hash file', async () => {
    const map = makeMap('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
    const result = await processSingleFile(
      map,
      path.join(fixturesDir, 'empty-hashes.txt'),
      'ascii',
    );
    expect(result).toHaveLength(0);
  });

  it('logs completion when logger is provided', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const logs: string[] = [];
    const mockLog = (msg: string) => { logs.push(msg); };

    const result = await processSingleFile(
      map,
      path.join(fixturesDir, 'sample-hashes.txt'),
      'ascii',
      mockLog,
    );

    expect(result).toHaveLength(1);
    expect(result[0].leaks).toBe(1000);
    expect(logs.some((l) => l.includes('Checked all'))).toBe(true);
    expect(logs.some((l) => l.includes('avg lines per second'))).toBe(true);
    expect(logs.some((l) => l.includes('Checking passwords time:'))).toBe(true);
    expect(logs.some((l) => l.includes('Checked passwords in'))).toBe(true);
  });

  it('rejects on invalid data in partial line at end of file', async () => {
    const map = makeMap('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
    await expect(
      processSingleFile(
        map,
        path.join(fixturesDir, 'partial-line-error-hashes.txt'),
        'ascii',
      ),
    ).rejects.toThrow('Invalid leak count');
  });

  it('handles file without trailing newline', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const result = await processSingleFile(
      map,
      path.join(fixturesDir, 'no-trailing-newline-hashes.txt'),
      'ascii',
    );
    expect(result).toHaveLength(1);
    expect(result[0].leaks).toBe(1000);
  });

  it('handles empty line in middle of file', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    map.set('B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3', [{ login_password: 'pass2' }]);
    const result = await processSingleFile(
      map,
      path.join(fixturesDir, 'empty-line-hashes.txt'),
      'ascii',
    );
    expect(result).toHaveLength(2);
    expect(result[0].leaks).toBe(1000);
    expect(result[1].leaks).toBe(500);
  });

  it('logs estimated time remaining when numberOfLines is provided', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const logs: string[] = [];
    const mockLog = (msg: string) => { logs.push(msg); };

    await processSingleFile(
      map,
      path.join(fixturesDir, 'sample-hashes.txt'),
      'ascii',
      mockLog,
      3,
    );

    expect(logs.some((l) => l.includes('Estimated time remaining: finishing up...'))).toBe(true);
    expect(logs.some((l) => l.includes('Checked all 3 lines.'))).toBe(true);
  });

  it('rejects on error during stream read', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-stream-error-'));
    const tempFile = path.join(tempDir, 'unreadable.txt');
    fs.writeFileSync(tempFile, 'anything');
    fs.chmodSync(tempFile, 0o000);
    const map = makeMap('SOMETHING');
    try {
      await expect(processSingleFile(map, tempFile, 'ascii')).rejects.toThrow();
    } finally {
      fs.chmodSync(tempFile, 0o644);
      fs.unlinkSync(tempFile);
      fs.rmdirSync(tempDir);
    }
  });
});
