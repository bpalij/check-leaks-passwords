import { vi } from 'vitest';

import { md4 } from './md4.js';

describe('md4', () => {
  it.each([
    ['', '31d6cfe0d16ae931b73c59d7e0c089c0'],
    ['a', 'bde52cb31de33e46245e05fbdbd6fb24'],
    ['abc', 'a448017aaf21d8525fc10ae87aa6729d'],
    ['message digest', 'd9130a8164549fe818874806e1c7014b'],
    ['abcdefghijklmnopqrstuvwxyz', 'd79e1c308aa5bbcdeea8ed63df412da9'],
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', '043f8582f241db351ce627e153e7f0e4'],
    ['12345678901234567890123456789012345678901234567890123456789012345678901234567890', 'e33b4ddc9c38f2199c3e7b164fcc0536'],
  ])('matches the RFC 1320 vector for %j', (input, expected) => {
    expect(md4(Buffer.from(input, 'ascii')).toString('hex')).toBe(expected);
  });

  it('returns a fresh 16-byte buffer', () => {
    const out = md4(Buffer.from('abc', 'ascii'));
    expect(out).toHaveLength(16);
    expect(out).not.toBe(md4(Buffer.from('abc', 'ascii')));
  });

  it('does not mutate the input buffer', () => {
    const input = Buffer.from('abc', 'ascii');
    const copy = Buffer.from(input);
    md4(input);
    expect(input).toEqual(copy);
  });

  it('zeroes its internal padded buffer after hashing', () => {
    const allocSpy = vi.spyOn(Buffer, 'alloc');
    try {
      const out = md4(Buffer.from('abc', 'ascii'));
      expect(out.toString('hex')).toBe('a448017aaf21d8525fc10ae87aa6729d');

      // 'abc' pads to a 64-byte block (3 + 0x80 + zero-fill + 8-byte length).
      const index = allocSpy.mock.calls.findIndex((args) => args[0] === 64);
      expect(index).toBeGreaterThanOrEqual(0);
      const captured = allocSpy.mock.results[index].value as Buffer;
      expect(captured.every((byte) => byte === 0)).toBe(true);
    } finally {
      allocSpy.mockRestore();
    }
  });
});
