import path from 'path';
import fs from 'fs';

import { vi } from 'vitest';

import { groupHashesByPrefix } from './groupByPrefix.js';
import { parseBuffer } from './parseBuffer.js';
import type { PasswordObject } from '../types.js';
import { FIXTURES_DIR } from '../../tests/helpers/fixturesDir.js';

describe('groupHashesByPrefix', () => {
  it('groups hashes with distinct prefixes into separate top-level entries with correct keys', () => {
    const input = new Map<string, PasswordObject[]>([['CBFDAC6008F9CAB4083784CBD1874F76618D2A97', [{ login_password: 'pass1' }]], ['B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3', [{ login_password: 'pass2' }]]]);
    const result = groupHashesByPrefix(input, 5);
    expect(result.size).toBe(2);

    const cbfdaEntry = result.get('CBFDA');
    expect(cbfdaEntry).toBeDefined();
    const innerCbfda = Array.from(cbfdaEntry!.map.values())[0];
    expect(innerCbfda.some((c) => c.fullHash === 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97')).toBe(true);

    const b7a87Entry = result.get('B7A87');
    expect(b7a87Entry).toBeDefined();
    const innerB7a87 = Array.from(b7a87Entry!.map.values())[0];
    expect(innerB7a87.some((c) => c.fullHash === 'B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3')).toBe(true);
  });

  it('reuses inner array when two hashes share same prefix and suffix key1', () => {
    const input = new Map<string, PasswordObject[]>([['CBFDAC6008F9CAB4083784CBD1874F76618D2A97', [{ login_password: 'pass1' }]], ['CBFDAC6008000000000000000000000000000000', [{ login_password: 'pass2' }]]]);
    const result = groupHashesByPrefix(input, 5);
    const prefixEntry = result.get('CBFDA');
    expect(prefixEntry?.map.size).toBe(1);
    const inner = Array.from(prefixEntry!.map.values())[0];
    expect(inner.length).toBe(2);
  });

  it('creates separate inner arrays for different suffix key1 under the same prefix', () => {
    const input = new Map<string, PasswordObject[]>([['CBFDAC6008F9CAB4083784CBD1874F76618D2A97', [{ login_password: 'pass1' }]], ['CBFDA0000000000000000000000000000000000', [{ login_password: 'pass2' }]]]);
    const result = groupHashesByPrefix(input, 5);
    const prefixEntry = result.get('CBFDA');
    expect(prefixEntry?.map.size).toBe(2);
    const allEntries = Array.from(prefixEntry!.map.values());
    expect(allEntries.some((arr) => arr.some((c) => c.fullHash === 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97'))).toBe(true);
    expect(allEntries.some((arr) => arr.some((c) => c.fullHash === 'CBFDA0000000000000000000000000000000000'))).toBe(true);
  });

  it('stores only hash lookup data (no passwordObjects) after grouping', () => {
    const input = new Map<string, PasswordObject[]>([['CBFDAC6008F9CAB4083784CBD1874F76618D2A97', [{ login_password: 'pass1' }, { login_password: 'pass1b' }]], ['B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3', [{ login_password: 'pass2' }]]]);
    const result = groupHashesByPrefix(input, 5);
    const cbfdaInner = Array.from(result.get('CBFDA')!.map.values())[0];
    const entry1 = cbfdaInner.find((c) => c.fullHash === 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    expect(entry1).toBeDefined();
    expect(entry1!.fullHashBytes).toBeInstanceOf(Buffer);
    expect(entry1!.fullHashBytes.length).toBe(40);
    expect('passwordObjects' in entry1!).toBe(false);
    const b7a87Inner = Array.from(result.get('B7A87')!.map.values())[0];
    const entry2 = b7a87Inner.find((c) => c.fullHash === 'B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3');
    expect(entry2).toBeDefined();
    expect(entry2!.fullHashBytes).toBeInstanceOf(Buffer);
  });
});

describe('groupHashesByPrefix with parseBuffer (integration)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses split-hashes-same-prefix fixture using grouped lookup map', async () => {
    const hashesWithPasswordObjects = new Map<string, PasswordObject[]>([['CBFDAC6008F9CAB4083784CBD1874F76618D2A97', [{ login_password: 'pass1' }]], ['CBFDA12345678901234567890123456789012345', [{ login_password: 'pass2' }]]]);
    const grouped = groupHashesByPrefix(hashesWithPasswordObjects, 5);
    const { map: suffixMap, set: fpSet } = grouped.get('CBFDA')!;
    expect(suffixMap).toBeDefined();

    const filePath = path.join(FIXTURES_DIR, 'split-hashes-same-prefix', 'CBFDA.txt');
    const fileContent = await fs.promises.readFile(filePath);

    const { stats, results } = parseBuffer(fileContent, 35, suffixMap, fpSet, 'ascii');
    expect(stats.linesProcessed).toBe(2);
    expect(stats.matchedHashCount).toBe(2);
    expect(results).toHaveLength(2);

    const r1 = results.find((r) => r.hash === 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    expect(r1).toBeDefined();
    expect(r1!.leaks).toBe(1000);

    const r2 = results.find((r) => r.hash === 'CBFDA12345678901234567890123456789012345');
    expect(r2).toBeDefined();
    expect(r2!.leaks).toBe(999);
  });
});
