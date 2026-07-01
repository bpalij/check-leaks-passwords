import path from 'path';
import fs from 'fs';
import { vi } from 'vitest';
import processSplitDirectory from '../src/helpers/processSplitDirectory';
import * as estimatedTimeRemainingModule from '../src/helpers/estimatedTimeRemaining';
import type { passwordObject } from '../src/interfaces/types';

const fixturesDir = path.resolve(__dirname, 'fixtures');

describe('processSplitDirectory', () => {
  const makeMap = (hash: string, objs: passwordObject[] = [{ login_password: 'pass' }]) => {
    const map = new Map<string, passwordObject[]>();
    map.set(hash, objs);
    return map;
  };

  it('handles split directory with matching hashes', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    map.set('B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3', [{ login_password: 'pass2' }]);
    map.set('076D3E6C4B9F654B5B220B9045B7458AB6B4CBC6', [{ login_password: 'pass3' }]);
    const result = await processSplitDirectory(
      map,
      path.join(fixturesDir, 'split-hashes'),
      'ascii',
    );
    expect(result).toHaveLength(3);
    const byHash = new Map(result.map((r) => [r.hash, r]));
    const getLeaks = (hash: string): number | undefined => {
      const entry = byHash.get(hash);
      return entry ? entry.leaks : undefined;
    };
    expect(getLeaks('CBFDAC6008F9CAB4083784CBD1874F76618D2A97')).toBe(1000);
    expect(getLeaks('B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3')).toBe(500);
    expect(getLeaks('076D3E6C4B9F654B5B220B9045B7458AB6B4CBC6')).toBe(250);
  });

  it('handles split directory with no matching hashes', async () => {
    const map = makeMap('0000000000000000000000000000000000000000');
    const result = await processSplitDirectory(
      map,
      path.join(fixturesDir, 'split-hashes'),
      'ascii',
    );
    expect(result).toHaveLength(0);
  });

  it('handles empty split directory', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const result = await processSplitDirectory(
      map,
      path.join(fixturesDir, 'split-hashes-empty'),
      'ascii',
    );
    expect(result).toHaveLength(0);
  });

  it('logs progress for split directory', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const logs: string[] = [];
    const mockLog = (msg: string) => { logs.push(msg); };

    await processSplitDirectory(
      map,
      path.join(fixturesDir, 'split-hashes'),
      'ascii',
      mockLog,
    );

    // t=0 initial log
    expect(logs.some((l) => l.includes('Already checked 0 from 1 (0%) prefix files'))).toBe(true);
    expect(logs.some((l) => l.includes('Reading 0 files per second'))).toBe(true);
    expect(logs.some((l) => l.includes('Checking passwords time:'))).toBe(true);
    expect(logs.some((l) => l.includes('Estimated time remaining: finishing up...'))).toBe(true);
    expect(logs.some((l) => l.includes('Checked passwords in'))).toBe(true);
    // final summary
    expect(logs.some((l) => l.includes('Checked all 1 prefix files.'
      + ' Found 1 hashes with total 1 000 leaks'))).toBe(true);
  });

  it('returns immediately for empty hash map', async () => {
    const map = new Map<string, passwordObject[]>();
    const result = await processSplitDirectory(map, '/some/path', 'ascii');
    expect(result).toEqual([]);
  });

  it('logs estimated time remaining with pending prefixes', async () => {
    vi.useFakeTimers();

    const map = new Map<string, passwordObject[]>();
    map.set('CBFDAC6008F9CAB4083784CBD1874F76618D2A97', [{ login_password: 'pass1' }]);
    map.set('B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3', [{ login_password: 'pass2' }]);
    map.set('076D3E6C4B9F654B5B220B9045B7458AB6B4CBC6', [{ login_password: 'pass3' }]);

    let readCallCount = 0;
    vi.spyOn(fs.promises, 'readFile').mockImplementation(async () => {
      readCallCount += 1;
      if (readCallCount === 1) {
        return Buffer.from('C6008F9CAB4083784CBD1874F76618D2A97:1000\n', 'ascii');
      }
      await new Promise((r) => setTimeout(r, 5000));
      return Buffer.from('...\n', 'ascii');
    });

    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };

    const processPromise = processSplitDirectory(map, '/fake/dir', 'ascii', logger);

    await vi.advanceTimersByTimeAsync(1000);
    expect(logs.some((l) => l.includes('Estimated time remaining:'))).toBe(true);

    await vi.advanceTimersByTimeAsync(10000);
    const results = await processPromise;
    expect(results).toHaveLength(1);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('skips eta log when estimated time is undefined', async () => {
    vi.spyOn(estimatedTimeRemainingModule, 'default').mockReturnValue(undefined);

    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    map.set('B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3', [{ login_password: 'pass2' }]);

    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };

    await processSplitDirectory(
      map,
      path.join(fixturesDir, 'split-hashes'),
      'ascii',
      logger,
    );

    expect(logs.some((l) => /^Estimated time remaining: \d/.test(l))).toBe(false);
    vi.restoreAllMocks();
  });

  it('rejects when prefix file read fails with non-ENOENT error', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');

    vi.spyOn(fs.promises, 'readFile').mockRejectedValue(
      Object.assign(new Error('Permission denied'), { code: 'EACCES' }),
    );

    await expect(
      processSplitDirectory(map, '/fake/dir', 'ascii'),
    ).rejects.toThrow('Permission denied');

    vi.restoreAllMocks();
  });

  it('logs zero avg files per second when total elapsed is zero', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);

    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');

    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(
      Buffer.from('C6008F9CAB4083784CBD1874F76618D2A97:1000\n', 'ascii'),
    );

    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };

    await processSplitDirectory(map, '/fake/dir', 'ascii', logger);

    expect(logs.some((l) => l.includes('Reading 0 files per second'))).toBe(true);

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('handles split directory with multiple hashes sharing same prefix', async () => {
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    map.set('CBFDA123456789012345678901234567890123456', [{ login_password: 'pass2' }]);
    const result = await processSplitDirectory(
      map,
      path.join(fixturesDir, 'split-hashes-same-prefix'),
      'ascii',
    );
    expect(result).toHaveLength(2);
    const byHash = new Map(result.map((r) => [r.hash, r]));
    expect(byHash.get('CBFDAC6008F9CAB4083784CBD1874F76618D2A97')?.leaks).toBe(1000);
    expect(byHash.get('CBFDA123456789012345678901234567890123456')?.leaks).toBe(999);
  });
});
