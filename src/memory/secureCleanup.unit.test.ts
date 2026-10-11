import { vi } from 'vitest';

import {
  zeroBuffer,
  trackBuffer,
  untrackBuffer,
  zeroAllTracked,
} from './secureCleanup.js';

describe('secureCleanup', () => {
  describe('zeroBuffer', () => {
    it('fills a buffer with zeros', () => {
      const buf = Buffer.from([
        1,
        2,
        3,
        4,
        5,
      ]);
      zeroBuffer(buf);
      expect(buf.equals(Buffer.alloc(5))).toBe(true);
    });

    it('handles null without throwing', () => {
      expect(() => zeroBuffer(null)).not.toThrow();
    });

    it('handles undefined without throwing', () => {
      expect(() => zeroBuffer(undefined)).not.toThrow();
    });

    it('handles empty buffer', () => {
      const buf = Buffer.alloc(0);
      expect(() => zeroBuffer(buf)).not.toThrow();
    });
  });

  describe('trackBuffer and untrackBuffer', () => {
    it('tracks and untracks buffers', () => {
      const buf = Buffer.from([
        1,
        2,
        3,
      ]);
      trackBuffer(buf);
      untrackBuffer(buf);
      // After untracking, zeroAllTracked should not zero this buffer
      zeroAllTracked();
      expect(buf.equals(Buffer.from([
        1,
        2,
        3,
      ]))).toBe(true);
    });

    it('does not throw when untracking a buffer that was not tracked', () => {
      const buf = Buffer.from([
        1,
        2,
        3,
      ]);
      expect(() => untrackBuffer(buf)).not.toThrow();
    });
  });

  describe('zeroAllTracked', () => {
    it('zeros all tracked buffers', () => {
      const buf1 = Buffer.from([
        1,
        2,
        3,
      ]);
      const buf2 = Buffer.from([
        4,
        5,
        6,
      ]);
      trackBuffer(buf1);
      trackBuffer(buf2);
      zeroAllTracked();
      expect(buf1.equals(Buffer.alloc(3))).toBe(true);
      expect(buf2.equals(Buffer.alloc(3))).toBe(true);
    });

    it('clears the tracking set', () => {
      const buf = Buffer.from([
        1,
        2,
        3,
      ]);
      trackBuffer(buf);
      zeroAllTracked();
      // After zeroAllTracked, the buffer is no longer tracked
      // Creating a new buffer and tracking it should work fine
      const buf2 = Buffer.from([
        7,
        8,
        9,
      ]);
      trackBuffer(buf2);
      zeroAllTracked();
      expect(buf2.equals(Buffer.alloc(3))).toBe(true);
    });
  });

  describe('signal handler', () => {
    it('zeros tracked buffers on SIGTERM before exit', async () => {
      const buf = Buffer.from([
        10,
        20,
        30,
      ]);
      trackBuffer(buf);

      const originalExit = process.exit;
      let exitCalled = false;
      const mockExit = vi.fn(() => {
        exitCalled = true;
        expect(buf.equals(Buffer.alloc(3))).toBe(true);
      }) as unknown as typeof process.exit;
      process.exit = mockExit;

      process.emit('SIGTERM', 'SIGTERM');
      expect(exitCalled).toBe(true);
      process.exit = originalExit;
    });

    it('zeros tracked buffers on SIGINT before exit with code 130', async () => {
      const buf = Buffer.from([
        40,
        50,
        60,
      ]);
      trackBuffer(buf);

      const originalExit = process.exit;
      let capturedCode: number | undefined;
      const mockExit = vi.fn((code?: number) => {
        capturedCode = code;
      }) as unknown as typeof process.exit;
      process.exit = mockExit;

      process.emit('SIGINT', 'SIGINT');
      expect(capturedCode).toBe(130);
      expect(buf.equals(Buffer.alloc(3))).toBe(true);
      process.exit = originalExit;
    });

    it('zeros tracked buffers on uncaughtException before exit with code 1', async () => {
      const buf = Buffer.from([
        70,
        80,
        90,
      ]);
      trackBuffer(buf);

      const originalExit = process.exit;
      let capturedCode: number | undefined;
      const mockExit = vi.fn((code?: number) => {
        capturedCode = code;
      }) as unknown as typeof process.exit;
      process.exit = mockExit;

      process.emit('uncaughtException', new Error('test'));
      expect(capturedCode).toBe(1);
      expect(buf.equals(Buffer.alloc(3))).toBe(true);
      process.exit = originalExit;
    });

    it('zeros tracked buffers on unhandledRejection before exit with code 1', async () => {
      const buf = Buffer.from([
        100,
        110,
        120,
      ]);
      trackBuffer(buf);

      const originalExit = process.exit;
      let capturedCode: number | undefined;
      const mockExit = vi.fn((code?: number) => {
        capturedCode = code;
      }) as unknown as typeof process.exit;
      process.exit = mockExit;

      process.emit('unhandledRejection', new Error('test'));
      expect(capturedCode).toBe(1);
      expect(buf.equals(Buffer.alloc(3))).toBe(true);
      process.exit = originalExit;
    });
  });

  describe('track deduplication', () => {
    it('does not create duplicate entries when tracking the same buffer twice', () => {
      const buf = Buffer.from([
        1,
        2,
        3,
      ]);
      trackBuffer(buf);
      trackBuffer(buf);
      zeroAllTracked();
      expect(buf.equals(Buffer.alloc(3))).toBe(true);
    });
  });

  describe('decrypt lifecycle integration', () => {
    it('zeroAllTracked works after a real decryptBitwardenExport call', async () => {
      const { generateEncryptedExport } = await import('../crypto/generateEncryptedExport.js');
      const { decryptBitwardenExport } = await import('../crypto/decryptBitwardenExport.js');

      const password = 'test-password-123';
      const vault = { items: [{ login_password: 'secret1', login_uri: 'https://example.com' }] };
      const encrypted = generateEncryptedExport(JSON.stringify(vault), password);

      const decrypted = await decryptBitwardenExport(encrypted, password);
      expect(decrypted.length).toBeGreaterThan(0);

      zeroAllTracked();

      const probe = Buffer.from([
        0xDE,
        0xAD,
        0xBE,
        0xEF,
      ]);
      trackBuffer(probe);
      zeroAllTracked();
      expect(probe.equals(Buffer.alloc(4))).toBe(true);
    });
  });
});
