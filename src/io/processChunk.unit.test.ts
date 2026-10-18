import { vi } from 'vitest';

import { processChunk, ChunkDescriptor } from './processChunk.js';
import type { PasswordObject } from '../types.js';
import { buildHashLookupMap } from '../hashing/buildLookupMap.js';
import { makeMap } from '../../tests/helpers/makeMap.js';
import { ntlm } from '../../tests/helpers/ntlm.js';

vi.mock('../constants', async () => {
  const actual = await vi.importActual('../constants');
  return { ...actual, HIGH_WATER_MARK: 16 };
});

function mockFileHandle(content: Buffer) {
  return {
    read: vi.fn(async (
      buffer: Buffer,
      bufferOffset: number,
      length: number,
      position: number | null,
    ) => {
      if (position === null || position >= content.length) {
        return { bytesRead: 0, buffer };
      }
      const bytesToCopy = Math.min(length, content.length - position);
      content.copy(buffer, bufferOffset, position, position + bytesToCopy);
      return { bytesRead: bytesToCopy, buffer };
    }),
    close: vi.fn(),
  };
}

function desc(overrides: Partial<ChunkDescriptor> = {}): ChunkDescriptor {
  return {
    readStart: 0,
    readEnd: 0,
    coreStart: 0,
    coreEnd: 0,
    isLast: true,
    ...overrides,
  };
}

describe('processChunk', () => {
  it('returns matching hashes with leak counts', async () => {
    const content = Buffer.from('CBFDAC6008F9CAB4083784CBD1874F76618D2A97:1000', 'ascii');
    const fd = mockFileHandle(content);
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const { map: hashLookupMap } = buildHashLookupMap(map);
    const fingerprintSet = new Set(hashLookupMap.keys());
    const d = desc({ readEnd: content.length - 1, isLast: true });
    const report = vi.fn();

    const result = await processChunk(d, fd as never, hashLookupMap, fingerprintSet, 'ascii', report);

    expect(result.results).toHaveLength(1);
    expect(result.results[0].hash).toBe('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    expect(result.results[0].leaks).toBe(1000);
    expect(result.bytesProcessed).toBe(content.length);
    expect(result.linesProcessed).toBe(1);
    expect(result.matchedHashCount).toBe(1);
    expect(result.cumulativeLeakCount).toBe(1000);
  });

  it('returns empty when no hashes match', async () => {
    const content = Buffer.from('NONEXISTENTHASH000000000000000000000000000:999', 'ascii');
    const fd = mockFileHandle(content);
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const { map: hashLookupMap } = buildHashLookupMap(map);
    const fingerprintSet = new Set(hashLookupMap.keys());
    const d = desc({ readEnd: content.length - 1, isLast: true });
    const report = vi.fn();

    const result = await processChunk(d, fd as never, hashLookupMap, fingerprintSet, 'ascii', report);

    expect(result.results).toHaveLength(0);
    expect(result.linesProcessed).toBe(1);
  });

  it('skips line with invalid leak count and reports rejectedLineCount', async () => {
    const content = Buffer.from('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8:invalid', 'ascii');
    const fd = mockFileHandle(content);
    const map = makeMap('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
    const { map: hashLookupMap } = buildHashLookupMap(map);
    const fingerprintSet = new Set(hashLookupMap.keys());
    const d = desc({ readEnd: content.length - 1, isLast: true });
    const report = vi.fn();

    const result = await processChunk(d, fd as never, hashLookupMap, fingerprintSet, 'ascii', report);
    expect(result.results).toHaveLength(0);
    expect(result.rejectedLineCount).toBe(1);
  });

  it('handles empty chunk (readStart > readEnd)', async () => {
    const fd = mockFileHandle(Buffer.alloc(0));
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const { map: hashLookupMap } = buildHashLookupMap(map);
    const fingerprintSet = new Set(hashLookupMap.keys());
    const d = desc({ readStart: 5, readEnd: 3 });
    const report = vi.fn();

    const result = await processChunk(d, fd as never, hashLookupMap, fingerprintSet, 'ascii', report);

    expect(result.results).toHaveLength(0);
    expect(result.bytesProcessed).toBe(0);
    expect(report).not.toHaveBeenCalled();
  });

  it('handles isLast with non-empty partial line buffer (trailing data without newline)', async () => {
    const content = Buffer.from('CBFDAC6008F9CAB4083784CBD1874F76618D2A97:1000', 'ascii');
    const fd = mockFileHandle(content);
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const { map: hashLookupMap } = buildHashLookupMap(map);
    const fingerprintSet = new Set(hashLookupMap.keys());
    const d = desc({ readEnd: content.length - 1, isLast: true });
    const report = vi.fn();

    const result = await processChunk(d, fd as never, hashLookupMap, fingerprintSet, 'ascii', report);

    expect(result.results).toHaveLength(1);
    expect(result.results[0].leaks).toBe(1000);
    expect(result.linesProcessed).toBe(1);
  });

  it('handles isLast with empty partial line buffer (trailing newline)', async () => {
    const content = Buffer.from('CBFDAC6008F9CAB4083784CBD1874F76618D2A97:1000\n', 'ascii');
    const fd = mockFileHandle(content);
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const { map: hashLookupMap } = buildHashLookupMap(map);
    const fingerprintSet = new Set(hashLookupMap.keys());
    const d = desc({ readEnd: content.length - 1, isLast: true });
    const report = vi.fn();

    const result = await processChunk(d, fd as never, hashLookupMap, fingerprintSet, 'ascii', report);

    expect(result.results).toHaveLength(1);
    expect(result.bytesProcessed).toBe(content.length);
  });

  it('processes two complete lines in one chunk', async () => {
    const h1 = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';
    const h2 = 'B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3';
    const content = Buffer.from(`${h1}:100\n${h2}:200\n`, 'ascii');
    const fd = mockFileHandle(content);
    const map = new Map<string, PasswordObject[]>();
    map.set(h1, [{ login_password: 'p1' }]);
    map.set(h2, [{ login_password: 'p2' }]);
    const { map: hashLookupMap } = buildHashLookupMap(map);
    const fingerprintSet = new Set(hashLookupMap.keys());
    const d = desc({ readEnd: content.length - 1, isLast: true });
    const report = vi.fn();

    const result = await processChunk(d, fd as never, hashLookupMap, fingerprintSet, 'ascii', report);

    expect(result.results).toHaveLength(2);
    const byHash = new Map(result.results.map((r) => [r.hash, r]));
    expect(byHash.get(h1)?.leaks).toBe(100);
    expect(byHash.get(h2)?.leaks).toBe(200);
    expect(result.linesProcessed).toBe(2);
  });

  it('handles empty line between hashes', async () => {
    const hash1 = 'A'.repeat(40);
    const hash2 = 'B'.repeat(40);
    const content = Buffer.from(`${hash1}:123\n\n${hash2}:456\n`, 'ascii');
    const fd = mockFileHandle(content);
    const map = new Map<string, PasswordObject[]>();
    map.set(hash1, [{ login_password: 'p1' }]);
    map.set(hash2, [{ login_password: 'p2' }]);
    const { map: hashLookupMap } = buildHashLookupMap(map);
    const fingerprintSet = new Set(hashLookupMap.keys());
    const d = desc({ readEnd: content.length - 1, isLast: true });
    const report = vi.fn();

    const result = await processChunk(d, fd as never, hashLookupMap, fingerprintSet, 'ascii', report);

    expect(result.results).toHaveLength(2);
  });

  it('reports progress for bytes, lines, matched, and leaks', async () => {
    const content = Buffer.from('CBFDAC6008F9CAB4083784CBD1874F76618D2A97:1000\n', 'ascii');
    const fd = mockFileHandle(content);
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const { map: hashLookupMap } = buildHashLookupMap(map);
    const fingerprintSet = new Set(hashLookupMap.keys());
    const d = desc({ readEnd: content.length - 1, isLast: true });
    const report = vi.fn();

    const result = await processChunk(d, fd as never, hashLookupMap, fingerprintSet, 'ascii', report);

    expect(result.results).toHaveLength(1);
    expect(report).toHaveBeenCalled();
    const bytesCalls = report.mock.calls.filter((args: number[]) => args[0] > 0);
    expect(bytesCalls.length).toBeGreaterThanOrEqual(1);
    const totalBytes = bytesCalls.reduce((sum: number, args: number[]) => sum + args[0], 0);
    expect(totalBytes).toBe(content.length);
  });

  it('calls reportProgress with lines and matched stats', async () => {
    const content = Buffer.from('CBFDAC6008F9CAB4083784CBD1874F76618D2A97:100\n', 'ascii');
    const fd = mockFileHandle(content);
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const { map: hashLookupMap } = buildHashLookupMap(map);
    const fingerprintSet = new Set(hashLookupMap.keys());
    const d = desc({ readEnd: content.length - 1, isLast: true });
    const report = vi.fn();

    await processChunk(d, fd as never, hashLookupMap, fingerprintSet, 'ascii', report);

    const lineMatchedCalls = report.mock.calls.filter(
      (args: number[]) => args[0] === 0 && args[1] > 0,
    );
    expect(lineMatchedCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('handles content without trailing newline with empty map', async () => {
    const content = Buffer.from('CBFDAC6008F9CAB4083784CBD1874F76618D2A97:100', 'ascii');
    const fd = mockFileHandle(content);
    const map = new Map<string, PasswordObject[]>();
    const { map: hashLookupMap } = buildHashLookupMap(map);
    const fingerprintSet = new Set(hashLookupMap.keys());
    const d = desc({ readEnd: content.length - 1, isLast: true });
    const report = vi.fn();

    const result = await processChunk(d, fd as never, hashLookupMap, fingerprintSet, 'ascii', report);

    expect(result.results).toHaveLength(0);
    expect(result.linesProcessed).toBe(1);
  });

  it('reads data across multiple buffer swaps with multi-read data', async () => {
    const h1 = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';
    const h2 = 'B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3';
    const content = Buffer.from(`${h1}:100\n${h2}:200\n`, 'ascii');
    const fd = mockFileHandle(content);
    const map = new Map<string, PasswordObject[]>();
    map.set(h1, [{ login_password: 'p1' }]);
    map.set(h2, [{ login_password: 'p2' }]);
    const { map: hashLookupMap } = buildHashLookupMap(map);
    const fingerprintSet = new Set(hashLookupMap.keys());
    const d = desc({ readEnd: content.length - 1, isLast: true });
    const report = vi.fn();

    const result = await processChunk(d, fd as never, hashLookupMap, fingerprintSet, 'ascii', report);

    expect(result.results).toHaveLength(2);
    expect(result.bytesProcessed).toBe(content.length);
    expect(result.linesProcessed).toBe(2);

    const bytesCalls = report.mock.calls.filter((args: number[]) => args[0] > 0);
    expect(bytesCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('handles read returning 0 bytes (EOF during iteration)', async () => {
    const content = Buffer.from('abc\n', 'ascii');
    const fd = mockFileHandle(content);
    const map = new Map<string, PasswordObject[]>();
    const { map: hashLookupMap } = buildHashLookupMap(map);
    const fingerprintSet = new Set(hashLookupMap.keys());
    const d = desc({ readEnd: content.length + 16, isLast: false });
    const report = vi.fn();

    const result = await processChunk(d, fd as never, hashLookupMap, fingerprintSet, 'ascii', report);

    expect(result.linesProcessed).toBe(1);
    expect(result.bytesProcessed).toBe(4);
  });

  it('does not process partial line when isLast is false (branch coverage)', async () => {
    const content = Buffer.from('abc\npartial', 'ascii');
    const fd = mockFileHandle(content);
    const map = new Map<string, PasswordObject[]>();
    const { map: hashLookupMap } = buildHashLookupMap(map);
    const fingerprintSet = new Set(hashLookupMap.keys());
    const d = desc({ readEnd: content.length - 1, isLast: false });
    const report = vi.fn();

    const result = await processChunk(d, fd as never, hashLookupMap, fingerprintSet, 'ascii', report);

    expect(result.linesProcessed).toBe(1);
    expect(result.bytesProcessed).toBe(content.length);
  });

  it('handles partial line across reads with batch progress flush', async () => {
    const h1 = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';
    const h2 = 'B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3';
    const h3 = '076D3E6C4B9F654B5B220B9045B7458AB6B4CBC6';
    const content = Buffer.from(`${h1}:100\n${h2}:200\n${h3}:300\n`, 'ascii');
    const fd = mockFileHandle(content);
    const map = new Map<string, PasswordObject[]>();
    map.set(h1, [{ login_password: 'p1' }]);
    map.set(h2, [{ login_password: 'p2' }]);
    map.set(h3, [{ login_password: 'p3' }]);
    const { map: hashLookupMap } = buildHashLookupMap(map);
    const fingerprintSet = new Set(hashLookupMap.keys());
    const d = desc({ readEnd: content.length - 1, isLast: true });
    const report = vi.fn();

    const result = await processChunk(d, fd as never, hashLookupMap, fingerprintSet, 'ascii', report);

    expect(result.results).toHaveLength(3);
    expect(result.bytesProcessed).toBe(content.length);
    expect(result.linesProcessed).toBe(3);

    const lineMatchedCalls = report.mock.calls.filter(
      (args: number[]) => args[0] === 0 && args[1] > 0,
    );
    expect(lineMatchedCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('handles bare carriage return as line separator', async () => {
    const h1 = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';
    const h2 = 'B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3';
    const content = Buffer.from(`${h1}:100\r${h2}:200\r`, 'ascii');
    const fd = mockFileHandle(content);
    const map = new Map<string, PasswordObject[]>();
    map.set(h1, [{ login_password: 'p1' }]);
    map.set(h2, [{ login_password: 'p2' }]);
    const { map: hashLookupMap } = buildHashLookupMap(map);
    const fingerprintSet = new Set(hashLookupMap.keys());
    const d = desc({ readEnd: content.length - 1, isLast: true });
    const report = vi.fn();

    const result = await processChunk(d, fd as never, hashLookupMap, fingerprintSet, 'ascii', report);

    expect(result.results).toHaveLength(2);
    expect(result.results[0].leaks).toBe(100);
    expect(result.results[1].leaks).toBe(200);
    expect(result.linesProcessed).toBe(2);
  });

  it('calls indexRecorder.recordBoundary when indexRecorder is provided', async () => {
    const h1 = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';
    const h2 = 'CBFDA12345678901234567890123456789012345';
    const content = Buffer.from(`${h1}:100\n${h2}:200\n`, 'ascii');
    const fd = mockFileHandle(content);
    const map = new Map<string, PasswordObject[]>();
    map.set(h1, [{ login_password: 'p1' }]);
    map.set(h2, [{ login_password: 'p2' }]);
    const { map: hashLookupMap } = buildHashLookupMap(map);
    const fingerprintSet = new Set(hashLookupMap.keys());
    const d = desc({ readEnd: content.length - 1, isLast: true });
    const report = vi.fn();
    const recordBoundary = vi.fn();
    const indexRecorder = { recordBoundary };

    const result = await processChunk(d, fd as never, hashLookupMap, fingerprintSet, 'ascii', report, indexRecorder);

    expect(result.results).toHaveLength(2);
    expect(recordBoundary).toHaveBeenCalled();
  });

  it('matches a 32-char NTLM full hash when fullHashLength is 32', async () => {
    const fullHash = ntlm('password123');
    expect(fullHash).toHaveLength(32);
    const content = Buffer.from(`${fullHash}:5000\n`, 'ascii');
    const fd = mockFileHandle(content);
    const map = makeMap(fullHash, [{ login_password: 'password123' }]);
    const { map: hashLookupMap } = buildHashLookupMap(map, 32);
    const fingerprintSet = new Set(hashLookupMap.keys());
    const d = desc({ readEnd: content.length - 1, isLast: true });
    const report = vi.fn();

    const result = await processChunk(
      d,
      fd as never,
      hashLookupMap,
      fingerprintSet,
      'ascii',
      report,
      undefined,
      undefined,
      32,
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0].hash).toBe(fullHash);
    expect(result.results[0].leaks).toBe(5000);
    expect(result.matchedHashCount).toBe(1);
  });

  it('does not match a 32-char NTLM line when fullHashLength is not threaded (default 40)', async () => {
    const fullHash = ntlm('password123');
    const content = Buffer.from(`${fullHash}:5000\n`, 'ascii');
    const fd = mockFileHandle(content);
    const map = makeMap(fullHash, [{ login_password: 'password123' }]);
    const { map: hashLookupMap } = buildHashLookupMap(map, 32);
    const fingerprintSet = new Set(hashLookupMap.keys());
    const d = desc({ readEnd: content.length - 1, isLast: true });
    const report = vi.fn();

    // Omitting the final argument leaves the SHA-1 default (40): the 32-char
    // line is shorter than the expected hash length, so nothing matches.
    const result = await processChunk(d, fd as never, hashLookupMap, fingerprintSet, 'ascii', report);

    expect(result.results).toHaveLength(0);
  });

  it('throws when line exceeds MAX_LINE_BYTES (no newlines across multiple reads)', async () => {
    const content = Buffer.alloc(300, 0x58); // 300 bytes of 'X', no newlines
    const fd = mockFileHandle(content);
    const map = new Map<string, PasswordObject[]>();
    const { map: hashLookupMap } = buildHashLookupMap(map);
    const fingerprintSet = new Set(hashLookupMap.keys());
    const d = desc({ readEnd: content.length - 1, isLast: false });
    const report = vi.fn();

    await expect(
      processChunk(d, fd as never, hashLookupMap, fingerprintSet, 'ascii', report),
    ).rejects.toThrow('Line exceeds maximum length');
  });
});
