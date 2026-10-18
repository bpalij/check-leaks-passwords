import { vi } from 'vitest';

import { parseBuffer } from './parseBuffer.js';
import type { PasswordObject, HashCandidate } from '../types.js';
import { ntlm } from '../../tests/helpers/ntlm.js';

describe('parseBuffer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const makeLookupMap = (hash: string, objs: PasswordObject[] = [{ login_password: 'pass' }]) => {
    const map = new Map<number, HashCandidate[]>();
    const hashBuf = Buffer.from(hash, 'ascii');
    const key1 = hashBuf.readUInt32BE(0);
    map.set(key1, [
      {
        fullHash: hash,
        fullHashBytes: hashBuf.subarray(0, 40),
        passwordObjects: objs,
      },
    ]);
    return { map, set: new Set([key1]) };
  };

  it('returns matching hashes with leak counts', () => {
    const { map, set } = makeLookupMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const buffer = Buffer.from('CBFDAC6008F9CAB4083784CBD1874F76618D2A97:1000\n');
    const { stats, results } = parseBuffer(buffer, 40, map, set, 'ascii');
    expect(results).toHaveLength(1);
    expect(results[0].leaks).toBe(1000);
    expect(results[0].hash).toBe('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    expect(stats.linesProcessed).toBe(1);
    expect(stats.matchedHashCount).toBe(1);
    expect(stats.cumulativeLeakCount).toBe(1000);
  });

  it('returns empty array when no hashes match', () => {
    const { map, set } = makeLookupMap('NONEXISTENTHASH000000000000000000000000000');
    const buffer = Buffer.from('CBFDAC6008F9CAB4083784CBD1874F76618D2A97:1000\n');
    const { stats, results } = parseBuffer(buffer, 40, map, set, 'ascii');
    expect(results).toHaveLength(0);
    expect(stats.matchedHashCount).toBe(0);
    expect(stats.cumulativeLeakCount).toBe(0);
  });

  it('returns empty array for empty buffer', () => {
    const { map, set } = makeLookupMap('SOMETHING');
    const buffer = Buffer.alloc(0);
    const { stats, results } = parseBuffer(buffer, 40, map, set, 'ascii');
    expect(results).toHaveLength(0);
    expect(stats.linesProcessed).toBe(0);
  });

  it('silently skips lines with empty hash before colon', () => {
    const { map, set } = makeLookupMap('ANYTHING');
    const buffer = Buffer.from(':500\n');
    const { stats, results } = parseBuffer(buffer, 40, map, set, 'ascii');
    expect(results).toHaveLength(0);
    expect(stats.linesProcessed).toBe(1);
  });

  it('skips line with invalid leak count and increments rejectedLineCount', () => {
    const { map, set } = makeLookupMap('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
    const buffer = Buffer.from('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8:abc\n');
    const { stats, results } = parseBuffer(buffer, 40, map, set, 'ascii');
    expect(results).toHaveLength(0);
    expect(stats.rejectedLineCount).toBe(1);
  });

  it('handles carriage return before newline', () => {
    const { map, set } = makeLookupMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const buffer = Buffer.from('CBFDAC6008F9CAB4083784CBD1874F76618D2A97:1000\r\n');
    const { stats, results } = parseBuffer(buffer, 40, map, set, 'ascii');
    expect(results).toHaveLength(1);
    expect(results[0].leaks).toBe(1000);
    expect(stats.linesProcessed).toBe(1);
  });

  it('silently skips lines without colon', () => {
    const { map, set: initialSet } = makeLookupMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const hashBuf2 = Buffer.from('B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3', 'ascii');
    const key1 = hashBuf2.readUInt32BE(0);
    const set = new Set(initialSet);
    set.add(key1);
    let arr = map.get(key1);
    if (!arr) {
      arr = [];
      map.set(key1, arr);
    }
    arr.push({
      fullHash: 'B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3',
      fullHashBytes: hashBuf2.subarray(0, 40),
      passwordObjects: [{ login_password: 'pass2' }],
    });
    const buffer = Buffer.from(
      'CBFDAC6008F9CAB4083784CBD1874F76618D2A97:1000\n'
      + 'B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3\n'
      + 'B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3:500\n',
    );
    const { stats, results } = parseBuffer(buffer, 40, map, set, 'ascii');
    expect(results).toHaveLength(2);
    expect(results[0].leaks).toBe(1000);
    expect(results[1].leaks).toBe(500);
    expect(stats.linesProcessed).toBe(3);
  });

  it('silently skips empty lines', () => {
    const { map, set: initialSet } = makeLookupMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const hashBuf2 = Buffer.from('B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3', 'ascii');
    const key1 = hashBuf2.readUInt32BE(0);
    const set = new Set(initialSet);
    set.add(key1);
    let arr = map.get(key1);
    if (!arr) {
      arr = [];
      map.set(key1, arr);
    }
    arr.push({
      fullHash: 'B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3',
      fullHashBytes: hashBuf2.subarray(0, 40),
      passwordObjects: [{ login_password: 'pass2' }],
    });
    const buffer = Buffer.from(
      'CBFDAC6008F9CAB4083784CBD1874F76618D2A97:1000\n'
      + '\n'
      + 'B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3:500\n',
    );
    const { stats, results } = parseBuffer(buffer, 40, map, set, 'ascii');
    expect(results).toHaveLength(2);
    expect(stats.linesProcessed).toBe(3);
  });

  it('skips entries with zero leak count (padding-proof)', () => {
    const { map, set } = makeLookupMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const buffer = Buffer.from('CBFDAC6008F9CAB4083784CBD1874F76618D2A97:0\nCBFDAC6008F9CAB4083784CBD1874F76618D2A97:500\n');
    const { stats, results } = parseBuffer(buffer, 40, map, set, 'ascii');
    expect(results).toHaveLength(1);
    expect(results[0].leaks).toBe(500);
    expect(stats.matchedHashCount).toBe(2);
    expect(stats.cumulativeLeakCount).toBe(500);
    expect(stats.linesProcessed).toBe(2);
  });

  it('handles buffer without trailing newline', () => {
    const { map, set } = makeLookupMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const buffer = Buffer.from('CBFDAC6008F9CAB4083784CBD1874F76618D2A97:2000');
    const { stats, results } = parseBuffer(buffer, 40, map, set, 'ascii');
    expect(results).toHaveLength(1);
    expect(results[0].leaks).toBe(2000);
    expect(stats.linesProcessed).toBe(1);
  });

  it('skips line where key1 matches but full hash does not', () => {
    const { map, set } = makeLookupMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const hashBuf2 = Buffer.from('CBFD123456789012345678901234567890123456', 'ascii');
    const key1 = hashBuf2.readUInt32BE(0);
    expect(set.has(key1)).toBe(true);
    const arr = map.get(key1);
    expect(arr).toBeDefined();
    expect(arr!.find((c) => c.fullHash === 'CBFD123456789012345678901234567890123456')).toBeUndefined();
    const buffer = Buffer.from(
      'CBFDAC6008F9CAB4083784CBD1874F76618D2A97:500\n'
      + 'CBFD123456789012345678901234567890123456:999\n',
    );
    const { stats, results } = parseBuffer(buffer, 40, map, set, 'ascii');
    expect(results).toHaveLength(1);
    expect(results[0].leaks).toBe(500);
    expect(stats.matchedHashCount).toBe(1);
    expect(stats.linesProcessed).toBe(2);
  });

  it('handles large leak count within safe integer range', () => {
    const { map, set } = makeLookupMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const buffer = Buffer.from('CBFDAC6008F9CAB4083784CBD1874F76618D2A97:123456789012345\n');
    const { stats, results } = parseBuffer(buffer, 40, map, set, 'ascii');
    expect(results).toHaveLength(1);
    expect(results[0].leaks).toBe(123456789012345);
    expect(stats.rejectedLineCount).toBe(0);
  });

  it('uses provided hashLength for suffix comparison', () => {
    const map = new Map<number, HashCandidate[]>();
    const fullHash = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';
    const fullHashBuf = Buffer.from(fullHash, 'ascii');
    const suffix = fullHash.slice(5);
    const key1 = Buffer.from(suffix, 'ascii').readUInt32BE(0);
    map.set(key1, [
      {
        fullHash,
        fullHashBytes: fullHashBuf.subarray(0, 40),
        passwordObjects: [{ login_password: 'pass' }],
      },
    ]);
    const set = new Set([key1]);
    const buffer = Buffer.from('C6008F9CAB4083784CBD1874F76618D2A97:1000\n');
    const { results } = parseBuffer(buffer, 35, map, set, 'ascii');
    expect(results).toHaveLength(1);
    expect(results[0].hash).toBe('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
  });

  it('rejects invalid leak count', () => {
    const { map, set } = makeLookupMap('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
    const buffer = Buffer.from('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8:abc\n');
    const { stats, results } = parseBuffer(buffer, 40, map, set, 'ascii');
    expect(results).toHaveLength(0);
    expect(stats.rejectedLineCount).toBe(1);
  });

  it('rejects leak count exceeding Number.MAX_SAFE_INTEGER', () => {
    const { map, set } = makeLookupMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const buffer = Buffer.from('CBFDAC6008F9CAB4083784CBD1874F76618D2A97:9007199254740992\n');
    const { stats, results } = parseBuffer(buffer, 40, map, set, 'ascii');
    expect(results).toHaveLength(0);
    expect(stats.rejectedLineCount).toBe(1);
    expect(stats.matchedHashCount).toBe(0);
  });

  it('handles bare carriage return as line separator (no \\n)', () => {
    const { map, set: initialSet } = makeLookupMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const hashBuf2 = Buffer.from('B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3', 'ascii');
    const key1 = hashBuf2.readUInt32BE(0);
    const set = new Set(initialSet);
    set.add(key1);
    let arr = map.get(key1);
    if (!arr) {
      arr = [];
      map.set(key1, arr);
    }
    arr.push({
      fullHash: 'B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3',
      fullHashBytes: hashBuf2.subarray(0, 40),
      passwordObjects: [{ login_password: 'pass2' }],
    });
    const buffer = Buffer.from(
      'CBFDAC6008F9CAB4083784CBD1874F76618D2A97:1000\r'
      + 'B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3:500\r',
    );
    const { stats, results } = parseBuffer(buffer, 40, map, set, 'ascii');
    expect(results).toHaveLength(2);
    expect(results[0].leaks).toBe(1000);
    expect(results[1].leaks).toBe(500);
    expect(stats.linesProcessed).toBe(2);
  });

  it('handles colon not at hashLength position via fallback search', () => {
    const { map, set } = makeLookupMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const buffer = Buffer.from('CBFDAC6008F9CAB4083784CBD1874F76618D2A97X:1000\n');
    const { stats, results } = parseBuffer(buffer, 40, map, set, 'ascii');
    expect(results).toHaveLength(1);
    expect(results[0].leaks).toBe(1000);
    expect(stats.matchedHashCount).toBe(1);
  });

  it('hexVal returns 0 for non-hex byte in prefix position', () => {
    const fullHash = 'CBFDG1E4C9B93F3F0682250B6CF8331B7EE68FD8';
    const { map, set } = makeLookupMap(fullHash);
    const buffer = Buffer.from(`${fullHash}:100\n`);
    const { stats, results } = parseBuffer(buffer, 40, map, set, 'ascii');
    expect(results).toHaveLength(1);
    expect(results[0].leaks).toBe(100);
    expect(stats.matchedHashCount).toBe(1);
  });

  it('calls recordBoundary when prefix differs from lastPrefix', () => {
    const fullHash = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';
    const { map, set } = makeLookupMap(fullHash);
    const recordBoundary = vi.fn();
    const lastPrefix = { value: 0 };
    const buffer = Buffer.from(`${fullHash}:100\n`);
    parseBuffer(buffer, 40, map, set, 'ascii', {
      recordBoundary,
      lastPrefix,
      bufferFileOffset: 100,
    });
    // eslint-disable-next-line no-bitwise
    const expectedPrefix = (12 << 16) | (11 << 12) | (15 << 8) | (13 << 4) | 10;
    expect(recordBoundary).toHaveBeenCalledWith(expectedPrefix, 100);
    expect(lastPrefix.value).toBe(expectedPrefix);
  });

  it('does not call recordBoundary when prefix matches lastPrefix', () => {
    const fullHash = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';
    const { map, set } = makeLookupMap(fullHash);
    const recordBoundary = vi.fn();
    // eslint-disable-next-line no-bitwise
    const expectedPrefix = (12 << 16) | (11 << 12) | (15 << 8) | (13 << 4) | 10;
    const lastPrefix = { value: expectedPrefix };
    const buffer = Buffer.from(`${fullHash}:100\n`);
    parseBuffer(buffer, 40, map, set, 'ascii', {
      recordBoundary,
      lastPrefix,
    });
    expect(recordBoundary).not.toHaveBeenCalled();
  });

  it('adjusts leakEnd when content ends with \\r before \\r\\n terminator', () => {
    const { map, set } = makeLookupMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const buffer = Buffer.from('CBFDAC6008F9CAB4083784CBD1874F76618D2A97:1000\r\r\n');
    const { stats, results } = parseBuffer(buffer, 40, map, set, 'ascii');
    expect(results).toHaveLength(1);
    expect(results[0].leaks).toBe(1000);
    expect(stats.matchedHashCount).toBe(1);
  });

  it('matches a 27-char NTLM suffix (skipBytes=5, hashLength=27, fullHashLength=32)', () => {
    const fullHash = ntlm('password123');
    const suffix = fullHash.slice(5);
    const key1 = Buffer.from(suffix, 'ascii').readUInt32BE(0);
    const map = new Map<number, HashCandidate[]>([
      [
        key1,
        [
          {
            fullHash,
            fullHashBytes: Buffer.from(fullHash, 'ascii').subarray(0, 32),
            passwordObjects: [{ login_password: 'password123' }],
          },
        ],
      ],
    ]);
    const set = new Set([key1]);
    const buffer = Buffer.from(`${suffix}:1000\n`, 'ascii');
    const { stats, results } = parseBuffer(buffer, 27, map, set, 'ascii', { fullHashLength: 32 });
    expect(results).toHaveLength(1);
    expect(results[0].hash).toBe(fullHash);
    expect(results[0].leaks).toBe(1000);
    expect(stats.matchedHashCount).toBe(1);
  });

  it('matches a full 32-char NTLM hash (skipBytes=0, hashLength=32, fullHashLength=32)', () => {
    const fullHash = ntlm('password123');
    const key1 = Buffer.from(fullHash, 'ascii').readUInt32BE(0);
    const map = new Map<number, HashCandidate[]>([
      [
        key1,
        [
          {
            fullHash,
            fullHashBytes: Buffer.from(fullHash, 'ascii').subarray(0, 32),
            passwordObjects: [{ login_password: 'password123' }],
          },
        ],
      ],
    ]);
    const set = new Set([key1]);
    const buffer = Buffer.from(`${fullHash}:77\n`, 'ascii');
    const { results } = parseBuffer(buffer, 32, map, set, 'ascii', { fullHashLength: 32 });
    expect(results).toHaveLength(1);
    expect(results[0].hash).toBe(fullHash);
    expect(results[0].leaks).toBe(77);
  });

  it('skips a line shorter than hashLength', () => {
    const fullHash = ntlm('password123');
    const suffix = fullHash.slice(5); // 27 chars
    const key1 = Buffer.from(fullHash, 'ascii').readUInt32BE(0);
    const map = new Map<number, HashCandidate[]>([
      [
        key1,
        [
          {
            fullHash,
            fullHashBytes: Buffer.from(fullHash, 'ascii').subarray(0, 32),
            passwordObjects: [{ login_password: 'password123' }],
          },
        ],
      ],
    ]);
    const set = new Set([key1]);
    // A 27-char suffix line must not match when the parser expects 32 chars.
    const buffer = Buffer.from(`${suffix}:1000\n`, 'ascii');
    const { stats, results } = parseBuffer(buffer, 32, map, set, 'ascii', { fullHashLength: 32 });
    expect(results).toHaveLength(0);
    expect(stats.matchedHashCount).toBe(0);
  });

  it('matches lower-case hex corpus lines against upper-case targets', () => {
    const fullHash = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';
    const { map, set } = makeLookupMap(fullHash);
    const buffer = Buffer.from(`${fullHash.toLowerCase()}:42\n`, 'ascii');
    const { results } = parseBuffer(buffer, 40, map, set, 'ascii');
    expect(results).toHaveLength(1);
    expect(results[0].hash).toBe(fullHash);
    expect(results[0].leaks).toBe(42);
  });

  const UTF8_BOM_BYTES = Buffer.from([
    0xef,
    0xbb,
    0xbf,
  ]);

  it('skips a leading UTF-8 BOM and matches the first line', () => {
    const fullHash = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';
    const { map, set } = makeLookupMap(fullHash);
    const buffer = Buffer.concat([UTF8_BOM_BYTES, Buffer.from(`${fullHash}:1000\n`, 'ascii')]);
    const { stats, results } = parseBuffer(buffer, 40, map, set, 'ascii');
    expect(results).toHaveLength(1);
    expect(results[0].hash).toBe(fullHash);
    expect(results[0].leaks).toBe(1000);
    expect(stats.matchedHashCount).toBe(1);
    expect(stats.linesProcessed).toBe(1);
  });

  it('skips a UTF-8 BOM at the start of a later line', () => {
    const firstHash = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';
    const secondHash = 'B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3';
    const map = new Map<number, HashCandidate[]>();
    const addTarget = (hash: string, pw: string) => {
      const hb = Buffer.from(hash, 'ascii');
      const key = hb.readUInt32BE(0);
      const arr = map.get(key) ?? [];
      arr.push({
        fullHash: hash,
        fullHashBytes: hb.subarray(0, 40),
        passwordObjects: [{ login_password: pw }],
      });
      map.set(key, arr);
    };
    addTarget(firstHash, 'pass1');
    addTarget(secondHash, 'pass2');
    const set = new Set(map.keys());
    const buffer = Buffer.concat([
      Buffer.from(`${firstHash}:1000\n`, 'ascii'),
      UTF8_BOM_BYTES,
      Buffer.from(`${secondHash}:500\n`, 'ascii'),
    ]);
    const { stats, results } = parseBuffer(buffer, 40, map, set, 'ascii');
    expect(results).toHaveLength(2);
    expect(results[0].hash).toBe(firstHash);
    expect(results[1].hash).toBe(secondHash);
    expect(results[1].leaks).toBe(500);
    expect(stats.linesProcessed).toBe(2);
  });

  it('does not match a buffer containing only a UTF-8 BOM', () => {
    const { map, set } = makeLookupMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const { stats, results } = parseBuffer(UTF8_BOM_BYTES, 40, map, set, 'ascii');
    expect(results).toHaveLength(0);
    expect(stats.matchedHashCount).toBe(0);
    expect(stats.linesProcessed).toBe(1);
  });
});
