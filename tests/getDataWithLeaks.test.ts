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

  it('dispatches to processSingleFile for a file path and returns matching hashes', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const result = await getDataWithLeaks(
      map,
      path.join(fixturesDir, 'sample-hashes.txt'),
      'ascii',
    );
    expect(result).toHaveLength(1);
    expect(result[0].leaks).toBe(1000);
  });

  it('dispatches to processSplitDirectory for a directory path and returns matching hashes', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const result = await getDataWithLeaks(
      map,
      path.join(fixturesDir, 'split-hashes'),
      'ascii',
    );
    expect(result).toHaveLength(1);
    expect(result[0].leaks).toBe(1000);
  });

  it('rejects on non-existent path', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    await expect(
      getDataWithLeaks(map, '/nonexistent/path.txt', 'ascii'),
    ).rejects.toThrow();
  });

  it('passes logger and numberOfLines correctly to single file path', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const logs: string[] = [];
    const mockLog = (msg: string) => { logs.push(msg); };
    const result = await getDataWithLeaks(
      map,
      path.join(fixturesDir, 'sample-hashes.txt'),
      'ascii',
      mockLog,
    );
    expect(result).toHaveLength(1);
    expect(logs.some((l) => l.includes('Checked all'))).toBe(true);
  });

  it('fingerprint filter does not prevent real matches from being found', async () => {
    const map = new Map<string, passwordObject[]>();
    const targetHash = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';
    const decoyHash = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    map.set(targetHash, [{ login_password: 'real-password' }]);
    map.set(decoyHash, [{ login_password: 'decoy' }]);
    map.set('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', [{ login_password: 'decoy2' }]);
    map.set('CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC', [{ login_password: 'decoy3' }]);
    const result = await getDataWithLeaks(
      map,
      path.join(fixturesDir, 'sample-hashes.txt'),
      'ascii',
    );
    expect(result).toHaveLength(1);
    expect(result[0].hash).toBe(targetHash);
    expect(result[0].leaks).toBe(1000);
  });

  it('fingerprint filter with many decoy hashes returns zero results when nothing matches', async () => {
    const map = new Map<string, passwordObject[]>();
    map.set('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', [{ login_password: 'nope' }]);
    map.set('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', [{ login_password: 'nope2' }]);
    const result = await getDataWithLeaks(
      map,
      path.join(fixturesDir, 'sample-hashes.txt'),
      'ascii',
    );
    expect(result).toHaveLength(0);
  });
});
