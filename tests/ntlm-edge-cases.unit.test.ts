import { describe, it, expect } from 'vitest';

import type { PasswordObject } from '../src/types.js';
import { buildHashLookupMap } from '../src/hashing/buildLookupMap.js';
import { parseBuffer } from '../src/hashing/parseBuffer.js';
import { hashPassword } from '../src/hashing/hashPassword.js';
import { NTLM_HEX_LENGTH, SHA1_HEX_LENGTH } from '../src/constants.js';
import { ntlm } from './helpers/ntlm.js';

describe('NTLM edge cases', () => {
  it('matches lower-case corpus hex against upper-case targets (case-insensitive)', () => {
    const upper = '8846F7EAEE8FB117AD06BDD830B7586C';
    const map = new Map<string, PasswordObject[]>();
    map.set(upper, [{ login_password: 'password' }]);
    const { map: lookup, set } = buildHashLookupMap(map, NTLM_HEX_LENGTH);

    const lowerLine = `${upper.toLowerCase()}:42\n`;
    const parsed = parseBuffer(
      Buffer.from(lowerLine, 'ascii'),
      NTLM_HEX_LENGTH,
      lookup,
      set,
      'ascii',
      { fullHashLength: NTLM_HEX_LENGTH },
    );

    expect(parsed.results).toEqual([{ hash: upper, leaks: 42 }]);
  });

  it('ignores CRLF terminators when matching NTLM hashes', () => {
    const upper = 'BECEDB42EC3C5C7F965255338BE4453C';
    const map = new Map<string, PasswordObject[]>();
    map.set(upper, [{ login_password: 'letmein' }]);
    const { map: lookup, set } = buildHashLookupMap(map, NTLM_HEX_LENGTH);

    const parsed = parseBuffer(
      Buffer.from(`${upper}:7\r\n`, 'ascii'),
      NTLM_HEX_LENGTH,
      lookup,
      set,
      'ascii',
      { fullHashLength: NTLM_HEX_LENGTH },
    );

    expect(parsed.results).toEqual([{ hash: upper, leaks: 7 }]);
  });

  it('hashes Unicode passwords consistently via UTF-16LE', () => {
    const password = 'pässwörd-Ω-пароль-🔐';
    expect(hashPassword(password, 'ntlm')).toBe(ntlm(password));
    expect(hashPassword(password, 'ntlm')).toHaveLength(NTLM_HEX_LENGTH);
    expect(hashPassword(password, 'sha1')).toHaveLength(SHA1_HEX_LENGTH);
    expect(hashPassword(password, 'ntlm')).not.toBe(hashPassword(password, 'sha1'));
  });
});
