import path from 'path';
import fs from 'fs';
import os from 'os';
import { vi } from 'vitest';
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
    expect(result[0].compactLeaks).toBe('1 K');
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
    expect(logs.some((l) => l.includes('Found') && l.includes('hashes'))).toBe(true);
    expect(logs.some((l) => l.includes('lines/s avg'))).toBe(true);
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

  it('handles partial line across chunk boundaries', async () => {
    const { PassThrough } = await import('stream');
    const mockStream = new PassThrough();

    vi.spyOn(fs, 'createReadStream').mockReturnValue(mockStream as never);
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1000 } as never);

    const map = new Map<string, passwordObject[]>();
    map.set('CBFDAC6008F9CAB4083784CBD1874F76618D2A97', [{ login_password: 'pass1' }]);
    map.set('B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3', [{ login_password: 'pass2' }]);

    const processPromise = processSingleFile(map, '/fake/path', 'ascii');

    mockStream.write(Buffer.from('CBFDAC6008F9CAB4083784CBD1874F76618D2', 'ascii'));
    mockStream.write(Buffer.from('A97', 'ascii'));
    mockStream.write(Buffer.from(':1000\nB7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3:500\n', 'ascii'));
    mockStream.end();

    const results = await processPromise;
    expect(results).toHaveLength(2);
    const byHash = new Map(results.map((r) => [r.hash, r]));
    expect(byHash.get('CBFDAC6008F9CAB4083784CBD1874F76618D2A97')?.leaks).toBe(1000);
    expect(byHash.get('B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3')?.leaks).toBe(500);
  });

  it('logs finishing up eta when all bytes are processed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { PassThrough } = await import('stream');
    const mockStream = new PassThrough();
    vi.spyOn(fs, 'createReadStream').mockReturnValue(mockStream as never);
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 124 } as never);

    const map = new Map<string, passwordObject[]>();

    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };

    const processPromise = processSingleFile(map, '/fake/path', 'ascii', logger);

    mockStream.write(
      Buffer.from(
        'CBFDAC6008F9CAB4083784CBD1874F76618D2A97:1000\n'
        + 'B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3:500\n'
        + '076D3E6C4B9F654B5B220B9045B7458AB6B4CBC6:250\n',
        'ascii',
      ),
    );

    await vi.advanceTimersByTimeAsync(1);

    mockStream.end();

    const results = await processPromise;
    expect(results).toHaveLength(0);
    expect(logs.some((l) => l.includes('finishing up'))).toBe(true);

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('logs zero avg lines per second when total elapsed is zero', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { PassThrough } = await import('stream');
    const mockStream = new PassThrough();
    vi.spyOn(fs, 'createReadStream').mockReturnValue(mockStream as never);
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1000 } as never);

    const map = new Map<string, passwordObject[]>();
    map.set('CBFDAC6008F9CAB4083784CBD1874F76618D2A97', [{ login_password: 'pass1' }]);

    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };

    const processPromise = processSingleFile(map, '/fake/path', 'ascii', logger);

    mockStream.write(Buffer.from('CBFDAC6008F9CAB4083784CBD1874F76618D2A97:1000\n', 'ascii'));
    mockStream.end();

    const results = await processPromise;
    expect(results).toHaveLength(1);
    expect(logs.some((l) => l.includes('0 lines/s avg'))).toBe(true);

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('skips line rate when linesPerSec is zero', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { PassThrough } = await import('stream');
    const mockStream = new PassThrough();
    vi.spyOn(fs, 'createReadStream').mockReturnValue(mockStream as never);
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1000 } as never);

    const map = new Map<string, passwordObject[]>();
    map.set('CBFDAC6008F9CAB4083784CBD1874F76618D2A97', [{ login_password: 'pass1' }]);

    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };

    const processPromise = processSingleFile(map, '/fake/path', 'ascii', logger);

    mockStream.write(Buffer.from('CBFDAC6008F9CAB4083784CBD1874F76618D2', 'ascii'));

    await vi.advanceTimersByTimeAsync(1500);

    expect(logs.some((l) => l.includes('Reading') && !l.includes('lines/s'))).toBe(true);

    mockStream.write(Buffer.from('A97:1000\n', 'ascii'));
    mockStream.end();

    const results = await processPromise;
    expect(results).toHaveLength(1);

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('skips eta log when estimatedTimeRemaining returns undefined', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { PassThrough } = await import('stream');
    const mockStream = new PassThrough();
    vi.spyOn(fs, 'createReadStream').mockReturnValue(mockStream as never);
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1000 } as never);

    const map = new Map<string, passwordObject[]>();
    map.set('CBFDAC6008F9CAB4083784CBD1874F76618D2A97', [{ login_password: 'pass1' }]);

    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };

    vi.spyOn(await import('../src/helpers/estimatedTimeRemaining'), 'default').mockReturnValue(undefined);

    const processPromise = processSingleFile(map, '/fake/path', 'ascii', logger);

    setTimeout(() => {
      mockStream.write(Buffer.from('CBFDAC6008F9CAB4083784CBD1874F76618D2A97:1000\n', 'ascii'));
    }, 100);
    setTimeout(() => {
      mockStream.end();
    }, 3000);

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(900);
    expect(logs.some((l) => l.includes('Estimated time remaining:'))).toBe(false);
    expect(logs.some((l) => l.includes('Already checked'))).toBe(true);

    await vi.advanceTimersByTimeAsync(3000);
    const results = await processPromise;
    expect(results).toHaveLength(1);

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('rejects when partial line concatenation forms invalid data', async () => {
    const { PassThrough } = await import('stream');
    const mockStream = new PassThrough();
    vi.spyOn(fs, 'createReadStream').mockReturnValue(mockStream as never);
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1000 } as never);

    const map = makeMap('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
    const processPromise = processSingleFile(map, '/fake/path', 'ascii');

    mockStream.write(Buffer.from('5BAA61E4C9B93F3F0682250B6CF8331B7EE', 'ascii'));
    mockStream.write(Buffer.from('68FD8:invalid\n', 'ascii'));
    mockStream.end();

    await expect(processPromise).rejects.toThrow('Invalid leak count');
    vi.restoreAllMocks();
  });

  it('logs estimated time remaining with pending progress', async () => {
    vi.useFakeTimers();
    const { PassThrough } = await import('stream');
    const mockStream = new PassThrough();
    vi.spyOn(fs, 'createReadStream').mockReturnValue(mockStream as never);
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1000 } as never);

    const map = new Map<string, passwordObject[]>();
    map.set('CBFDAC6008F9CAB4083784CBD1874F76618D2A97', [{ login_password: 'pass1' }]);

    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };

    const processPromise = processSingleFile(map, '/fake/path', 'ascii', logger);

    setTimeout(() => {
      mockStream.write(Buffer.from('CBFDAC6008F9CAB4083784CBD1874F76618D2A97:1000\n', 'ascii'));
    }, 100);
    setTimeout(() => {
      mockStream.end();
    }, 3000);

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(900);
    expect(logs.some((l) => l.includes('Estimated time remaining:'))).toBe(true);

    await vi.advanceTimersByTimeAsync(3000);
    const results = await processPromise;
    expect(results).toHaveLength(1);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('logs estimated total lines when processing more than 1000 lines', async () => {
    const { PassThrough } = await import('stream');
    const mockStream = new PassThrough();
    vi.spyOn(fs, 'createReadStream').mockReturnValue(mockStream as never);

    const map = new Map<string, passwordObject[]>();
    map.set('0000000000000000000000000000000000000001', [{ login_password: 'pass1' }]);

    const lines: string[] = [];
    for (let i = 1; i <= 1001; i += 1) {
      const hash = `000${String(i).padStart(37, '0')}`;
      lines.push(`${hash}:${i}`);
    }
    const buf = Buffer.from(`${lines.join('\n')}\n`, 'ascii');
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: buf.length } as never);

    const logs: string[] = [];
    const logger = (msg: string) => { logs.push(msg); };

    const processPromise = processSingleFile(map, '/fake/path', 'ascii', logger);

    mockStream.write(buf);
    mockStream.end();

    const results = await processPromise;
    expect(results).toHaveLength(1);
    expect(results[0].hash).toBe('0000000000000000000000000000000000000001');
    expect(logs.some((l) => l.includes('of ~'))).toBe(true);
    vi.restoreAllMocks();
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
