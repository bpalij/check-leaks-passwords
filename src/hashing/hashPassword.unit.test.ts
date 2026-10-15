import { vi } from 'vitest';

import { md4 } from '../crypto/md4.js';
import { hashPassword } from './hashPassword.js';

describe('hashPassword', () => {
  describe('ntlm (MD4 of UTF-16LE)', () => {
    it.each([
      ['password', '8846F7EAEE8FB117AD06BDD830B7586C'],
      ['00000000', '9BDC61DB5A3FCED6D82D49279F1F0430'],
      ['123456', '32ED87BDB5FDC5E9CBA88547376818D4'],
      ['letmein', 'BECEDB42EC3C5C7F965255338BE4453C'],
      ['password123', 'A9FDFA038C4B75EBC76DC855DD74F0DA'],
    ])('hashes %j to the reference vector', (password, expected) => {
      expect(hashPassword(password, 'ntlm')).toBe(expected);
    });

    it('returns 32 uppercase hex characters', () => {
      const digest = hashPassword('password', 'ntlm');
      expect(digest).toMatch(/^[0-9A-F]{32}$/);
    });

    it('encodes the password as UTF-16LE, not UTF-8', () => {
      // Non-ASCII input distinguishes UTF-16LE from UTF-8. Pinned via the
      // independently RFC-verified MD4 implementation.
      const password = 'pässwörd€';
      expect(hashPassword(password, 'ntlm')).toBe(
        md4(Buffer.from(password, 'utf16le')).toString('hex').toUpperCase(),
      );
      expect(hashPassword(password, 'ntlm')).not.toBe(
        md4(Buffer.from(password, 'utf8')).toString('hex').toUpperCase(),
      );
    });
  });

  describe('sha1', () => {
    it('hashes password to the known SHA-1 vector', () => {
      expect(hashPassword('password', 'sha1')).toBe('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
    });

    it('returns 40 uppercase hex characters', () => {
      const digest = hashPassword('password', 'sha1');
      expect(digest).toMatch(/^[0-9A-F]{40}$/);
    });
  });

  describe('sensitive buffer lifetime', () => {
    it('zeroes the UTF-16LE password buffer after NTLM hashing', () => {
      const fromSpy = vi.spyOn(Buffer, 'from');
      try {
        const digest = hashPassword('password', 'ntlm');
        expect(digest).toBe('8846F7EAEE8FB117AD06BDD830B7586C');

        const index = fromSpy.mock.calls.findIndex(
          (args) => args[0] === 'password' && args[1] === 'utf16le',
        );
        expect(index).toBeGreaterThanOrEqual(0);
        const captured = fromSpy.mock.results[index].value as Buffer;
        expect(captured).toHaveLength(16);
        expect(captured.every((byte) => byte === 0)).toBe(true);
      } finally {
        fromSpy.mockRestore();
      }
    });

    it('zeroes the UTF-8 password buffer after SHA-1 hashing', () => {
      const fromSpy = vi.spyOn(Buffer, 'from');
      try {
        const digest = hashPassword('password', 'sha1');
        expect(digest).toBe('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');

        const index = fromSpy.mock.calls.findIndex(
          (args) => args[0] === 'password' && args[1] === 'utf8',
        );
        expect(index).toBeGreaterThanOrEqual(0);
        const captured = fromSpy.mock.results[index].value as Buffer;
        expect(captured.every((byte) => byte === 0)).toBe(true);
      } finally {
        fromSpy.mockRestore();
      }
    });
  });
});
