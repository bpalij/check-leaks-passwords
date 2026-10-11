import os from 'os';

import {
  describe, it, expect, vi, afterEach,
} from 'vitest';

import { parseEnvInt } from './parseEnvInt.js';

vi.mock('child_process', () => ({
  execSync: vi.fn(() => { throw new Error('command not found'); }),
}));

vi.spyOn(os, 'freemem').mockReturnValue(1024 * 1024 * 512);

describe('getAvailableMemBytes', () => {
  it('falls back to os.freemem() when execSync throws on darwin', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });

    try {
      const { getAvailableMemBytes } = await import('./getAvailableMemBytes.js');
      const result = getAvailableMemBytes();
      expect(result).toBe(1024 * 1024 * 512);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    }
  });

  it('uses os.freemem() on non-darwin platform', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', writable: true });

    try {
      const { getAvailableMemBytes } = await import('./getAvailableMemBytes.js');
      const result = getAvailableMemBytes();
      expect(result).toBe(1024 * 1024 * 512);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    }
  });
});

describe('parseEnvInt', () => {
  const ENV_KEY = 'TEST_PARSE_ENV_INT';

  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('returns fallback when env var is undefined', () => {
    expect(parseEnvInt(ENV_KEY, 1, 100, 5)).toBe(5);
  });

  it('returns parsed value when in range', () => {
    process.env[ENV_KEY] = '42';
    expect(parseEnvInt(ENV_KEY, 1, 100, 5)).toBe(42);
  });

  it('returns fallback for non-numeric value and warns', () => {
    const logger = vi.fn();
    process.env[ENV_KEY] = 'abc';
    expect(parseEnvInt(ENV_KEY, 1, 100, 5, logger)).toBe(5);
    expect(logger).toHaveBeenCalledWith(
      'TEST_PARSE_ENV_INT="abc" is not a valid integer (min 1), using 5',
    );
  });

  it('returns fallback for negative value and warns', () => {
    const logger = vi.fn();
    process.env[ENV_KEY] = '-1';
    expect(parseEnvInt(ENV_KEY, 1, 100, 5, logger)).toBe(5);
    expect(logger).toHaveBeenCalledOnce();
  });

  it('returns fallback for zero when min is 1 and warns', () => {
    const logger = vi.fn();
    process.env[ENV_KEY] = '0';
    expect(parseEnvInt(ENV_KEY, 1, 100, 5, logger)).toBe(5);
    expect(logger).toHaveBeenCalledOnce();
  });

  it('caps to max and warns when value exceeds max', () => {
    const logger = vi.fn();
    process.env[ENV_KEY] = '999';
    expect(parseEnvInt(ENV_KEY, 1, 100, 5, logger)).toBe(100);
    expect(logger).toHaveBeenCalledWith(
      'TEST_PARSE_ENV_INT=999 exceeds maximum 100, using 100',
    );
  });

  it('returns value at exact min boundary', () => {
    process.env[ENV_KEY] = '1';
    expect(parseEnvInt(ENV_KEY, 1, 100, 5)).toBe(1);
  });

  it('returns value at exact max boundary', () => {
    process.env[ENV_KEY] = '100';
    expect(parseEnvInt(ENV_KEY, 1, 100, 5)).toBe(100);
  });

  it('works without logger (no crash)', () => {
    process.env[ENV_KEY] = 'abc';
    expect(parseEnvInt(ENV_KEY, 1, 100, 5)).toBe(5);
  });
});
