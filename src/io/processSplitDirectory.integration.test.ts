import path from 'path';

import { describe, it, expect } from 'vitest';

import type { PasswordObject } from '../types.js';
import { processSplitDirectory } from './processSplitDirectory.js';
import { NTLM_HEX_LENGTH } from '../constants.js';
import { FIXTURES_DIR } from '../../tests/helpers/fixturesDir.js';

const fixturesDir = FIXTURES_DIR;

describe('processSplitDirectory NTLM split-prefix directory (real workers)', () => {
  function ntlmMap(): Map<string, PasswordObject[]> {
    const map = new Map<string, PasswordObject[]>();
    map.set('32ED87BDB5FDC5E9CBA88547376818D4', [{ login_password: '123456' }]);
    map.set('8846F7EAEE8FB117AD06BDD830B7586C', [{ login_password: 'password' }]);
    map.set('9BDC61DB5A3FCED6D82D49279F1F0430', [{ login_password: '00000000' }]);
    map.set('A9FDFA038C4B75EBC76DC855DD74F0DA', [{ login_password: 'password123' }]);
    map.set('BECEDB42EC3C5C7F965255338BE4453C', [{ login_password: 'letmein' }]);
    map.set('00000000000000000000000000000000', [{ login_password: 'not-leaked' }]);
    return map;
  }

  it('finds all matching prefixes and reports correct leak counts', { timeout: 60000 }, async () => {
    const results = await processSplitDirectory(
      ntlmMap(),
      path.join(fixturesDir, 'ntlm-split'),
      'ascii',
      undefined,
      undefined,
      NTLM_HEX_LENGTH,
    );

    const byHash = new Map(results.map((r) => [r.hash, r]));
    expect(byHash.get('32ED87BDB5FDC5E9CBA88547376818D4')?.leaks).toBe(37281043);
    expect(byHash.get('8846F7EAEE8FB117AD06BDD830B7586C')?.leaks).toBe(99999);
    expect(byHash.get('9BDC61DB5A3FCED6D82D49279F1F0430')?.leaks).toBe(250);
    expect(byHash.get('A9FDFA038C4B75EBC76DC855DD74F0DA')?.leaks).toBe(1000);
    expect(byHash.get('BECEDB42EC3C5C7F965255338BE4453C')?.leaks).toBe(250000);
    expect(byHash.has('00000000000000000000000000000000')).toBe(false);
  });
});
