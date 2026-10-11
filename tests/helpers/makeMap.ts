import type { PasswordObject } from '../../src/types.js';

export function makeMap(
  hash: string,
  objs: PasswordObject[] = [{ login_password: 'pass' }],
): Map<string, PasswordObject[]> {
  const map = new Map<string, PasswordObject[]>();
  map.set(hash, objs);
  return map;
}
