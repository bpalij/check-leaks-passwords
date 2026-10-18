import { convertArrayToMap } from './convertArrayToMap.js';
import { buildHashLookupMap } from './buildLookupMap.js';
import type { PasswordObjectWithHash, PasswordObject } from '../types.js';
import { ntlm } from '../../tests/helpers/ntlm.js';

describe('convertArrayToMap', () => {
  it('converts a single entry to a map', () => {
    const input: PasswordObjectWithHash[] = [{ hash: 'ABC', passwordObject: { login_password: 'pass1' } }];
    const result = convertArrayToMap(input);
    expect(result.size).toBe(1);
    expect(result.get('ABC')).toEqual([{ login_password: 'pass1' }]);
  });

  it('groups entries with the same hash', () => {
    const input: PasswordObjectWithHash[] = [
      { hash: 'ABC', passwordObject: { login_password: 'pass1', name: 'a' } },
      { hash: 'ABC', passwordObject: { login_password: 'pass2', name: 'b' } },
      { hash: 'DEF', passwordObject: { login_password: 'pass3' } },
    ];
    const result = convertArrayToMap(input);
    expect(result.size).toBe(2);
    expect(result.get('ABC')).toHaveLength(2);
    expect(result.get('ABC')).toEqual([{ login_password: 'pass1', name: 'a' }, { login_password: 'pass2', name: 'b' }]);
    expect(result.get('DEF')).toEqual([{ login_password: 'pass3' }]);
  });

  it('returns empty map for empty array', () => {
    const result = convertArrayToMap([]);
    expect(result.size).toBe(0);
  });
});

describe('buildHashLookupMap', () => {
  it('builds a lookup map from a hash-to-objects map', () => {
    const input = new Map<string, PasswordObject[]>([['CBFDAC6008F9CAB4083784CBD1874F76618D2A97', [{ login_password: 'pass1' }]], ['B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3', [{ login_password: 'pass2' }]]]);
    const { map, set } = buildHashLookupMap(input);
    expect(map.size).toBe(2);
    expect(set.size).toBe(2);
  });

  it('groups hashes sharing the first 4 key bytes under the same inner array', () => {
    const input = new Map<string, PasswordObject[]>([['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', [{ login_password: 'pass1' }]], ['AAAA000000000000000000000000000000000000', [{ login_password: 'pass2' }]]]);
    const { map, set } = buildHashLookupMap(input);
    expect(map.size).toBe(1);
    expect(set.size).toBe(1);
    const firstKey = Array.from(map.keys())[0];
    const inner = map.get(firstKey);
    expect(inner?.length).toBe(2);
  });

  it('truncates fullHashBytes to 32 bytes for NTLM', () => {
    const hash = ntlm('password123');
    const input = new Map<string, PasswordObject[]>([[hash, [{ login_password: 'password123' }]]]);
    const { map } = buildHashLookupMap(input, 32);
    const entries = Array.from(map.values())[0];
    expect(entries[0].fullHashBytes).toHaveLength(32);
    expect(entries[0].fullHash).toBe(hash);
  });

  it('keeps fullHashBytes at 40 bytes by default (SHA-1)', () => {
    const hash = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';
    const input = new Map<string, PasswordObject[]>([[hash, [{ login_password: 'pass1' }]]]);
    const { map } = buildHashLookupMap(input);
    const entries = Array.from(map.values())[0];
    expect(entries[0].fullHashBytes).toHaveLength(40);
  });
});
