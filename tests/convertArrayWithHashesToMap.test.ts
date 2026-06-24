import convertArrayWithHashesToMap from '../src/helpers/convertArrayWithHashesToMap';
import type { passwordObjectWithHash } from '../src/interfaces/types';

describe('convertArrayWithHashesToMap', () => {
  it('converts a single entry to a map', () => {
    const input: passwordObjectWithHash[] = [
      { hash: 'ABC', passwordObject: { login_password: 'pass1' } },
    ];
    const result = convertArrayWithHashesToMap(input);
    expect(result.size).toBe(1);
    expect(result.get('ABC')).toEqual([{ login_password: 'pass1' }]);
  });

  it('groups entries with the same hash', () => {
    const input: passwordObjectWithHash[] = [
      { hash: 'ABC', passwordObject: { login_password: 'pass1', name: 'a' } },
      { hash: 'ABC', passwordObject: { login_password: 'pass2', name: 'b' } },
      { hash: 'DEF', passwordObject: { login_password: 'pass3' } },
    ];
    const result = convertArrayWithHashesToMap(input);
    expect(result.size).toBe(2);
    expect(result.get('ABC')).toHaveLength(2);
    expect(result.get('ABC')![0]).toEqual({ login_password: 'pass1', name: 'a' });
    expect(result.get('ABC')![1]).toEqual({ login_password: 'pass2', name: 'b' });
    expect(result.get('DEF')).toEqual([{ login_password: 'pass3' }]);
  });

  it('returns empty map for empty array', () => {
    const result = convertArrayWithHashesToMap([]);
    expect(result.size).toBe(0);
  });

  it('deep copies the password objects', () => {
    const input: passwordObjectWithHash[] = [
      { hash: 'ABC', passwordObject: { login_password: 'pass1' } },
    ];
    const result = convertArrayWithHashesToMap(input);
    const obj = result.get('ABC')![0];
    expect(obj).not.toBe(input[0].passwordObject);
  });
});
