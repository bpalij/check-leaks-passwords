import path from 'path';
import getDataWithLeaks from '../src/helpers/getDataWithLeaks';
import type { passwordObject } from '../src/interfaces/types';

const fixturesDir = path.resolve(__dirname, 'fixtures');

describe('getDataWithLeaks', () => {
  const makeMap = (hash: string, objs: passwordObject[] = [{ login_password: 'pass' }]) => {
    const map = new Map<string, passwordObject[]>();
    map.set(hash, objs);
    return map;
  };

  it('returns matching hashes with leak counts', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const result = await getDataWithLeaks(
      map,
      path.join(fixturesDir, 'sample-hashes.txt'),
      'utf-8',
      undefined,
      undefined,
    );
    expect(result).toHaveLength(1);
    expect(result[0].hash).toBe('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    expect(result[0].leaks).toBe(1000);
    expect(result[0].readableLeaks).toBe('1 000');
  });

  it('returns empty array when no hashes match', async () => {
    const map = makeMap('NONEXISTENTHASH000000000000000000000000000');
    const result = await getDataWithLeaks(
      map,
      path.join(fixturesDir, 'sample-hashes.txt'),
      'utf-8',
      undefined,
      undefined,
    );
    expect(result).toHaveLength(0);
  });

  it('rejects on invalid line in hashes file', async () => {
    const map = makeMap('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
    await expect(
      getDataWithLeaks(
        map,
        path.join(fixturesDir, 'invalid-hashes.txt'),
        'utf-8',
        undefined,
        undefined,
      ),
    ).rejects.toThrow('Line 1 in hashes file is incorrect');
  });

  it('returns empty array for empty hash file', async () => {
    const map = makeMap('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
    const result = await getDataWithLeaks(
      map,
      path.join(fixturesDir, 'empty-hashes.txt'),
      'utf-8',
      undefined,
      undefined,
    );
    expect(result).toHaveLength(0);
  });

  it('logs completion when logger is provided', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const logs: string[] = [];
    const mockLogger = { log: (msg: string) => { logs.push(msg); } } as Console;

    const result = await getDataWithLeaks(
      map,
      path.join(fixturesDir, 'sample-hashes.txt'),
      'utf-8',
      undefined,
      mockLogger,
    );

    expect(result).toHaveLength(1);
    expect(result[0].leaks).toBe(1000);
    expect(logs.some((l) => l.includes('Checked all'))).toBe(true);
  });
});
