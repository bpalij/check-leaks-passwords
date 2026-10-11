import {
  vi, describe, it, expect, afterEach,
} from 'vitest';

import { measureSequentialSpeedFromDir } from './detectHDD.js';

const { mockOpen, mockAccess } = vi.hoisted(() => ({
  mockOpen: vi.fn(),
  mockAccess: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    promises: {
      open: mockOpen,
      access: mockAccess,
    },
  },
}));

function makeMockFd(
  opts?: { size?: number; readFn?: () => Promise<{ bytesRead: number; buffer: Buffer }> },
) {
  return {
    read: opts?.readFn ?? vi.fn().mockResolvedValue({ bytesRead: 0, buffer: Buffer.alloc(0) }),
    stat: vi.fn().mockResolvedValue({ size: opts?.size ?? 1000 }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe('measureSequentialSpeedFromDir', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockOpen.mockReset();
    mockAccess.mockReset();
  });

  it('returns SSD when directory does not exist', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    const result = await measureSequentialSpeedFromDir('/nonexistent/dir');
    expect(result.isHDD).toBe(false);
    expect(result.iopMBps).toBe(0);
  });

  it('returns true (HDD) when sequential speed is slow', async () => {
    mockAccess.mockResolvedValue(undefined);
    const mockFd = makeMockFd({ size: 1000 });
    mockOpen.mockResolvedValue(mockFd);

    let callCount = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      const val = callCount % 2 === 0 ? 0 : 100;
      callCount += 1;
      return val;
    });

    const result = await measureSequentialSpeedFromDir('/test/dir');
    expect(result.isHDD).toBe(true);
    expect(result.iopMBps).toBeGreaterThan(0);
  });

  it('returns false (SSD) when sequential speed is fast', async () => {
    mockAccess.mockResolvedValue(undefined);
    const mockFd = makeMockFd({ size: 1000 });
    mockOpen.mockResolvedValue(mockFd);

    let callCount = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      const val = callCount % 2 === 0 ? 0 : 0.001;
      callCount += 1;
      return val;
    });

    const result = await measureSequentialSpeedFromDir('/test/dir');
    expect(result.isHDD).toBe(false);
  });

  it('returns false after 11 consecutive file misses', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockOpen.mockRejectedValue(new Error('ENOENT'));

    const result = await measureSequentialSpeedFromDir('/empty/dir');
    expect(result.isHDD).toBe(false);
    expect(mockOpen).toHaveBeenCalledTimes(11);
  });

  it('calls logger on consecutive miss bailout', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockOpen.mockRejectedValue(new Error('ENOENT'));

    const logger = vi.fn();
    const result = await measureSequentialSpeedFromDir('/empty/dir', logger);
    expect(result.isHDD).toBe(false);
    expect(logger).toHaveBeenCalledWith(
      'Disk type detection: too many missing prefixes, assuming non-HDD',
    );
  });

  it('handles file with size 0', async () => {
    mockAccess.mockResolvedValue(undefined);
    const mockFd = makeMockFd({ size: 0 });
    mockOpen.mockResolvedValue(mockFd);

    let callCount = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      const val = callCount % 2 === 0 ? 0 : 0.5;
      callCount += 1;
      return val;
    });

    const result = await measureSequentialSpeedFromDir('/test/dir');
    expect(typeof result.isHDD).toBe('boolean');
    expect(mockOpen).toHaveBeenCalled();
  });

  it('closes opened file handles after reading 3 files', async () => {
    mockAccess.mockResolvedValue(undefined);

    const mockFd = makeMockFd({ size: 1000 });
    mockOpen.mockResolvedValue(mockFd);

    let callCount = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      const val = callCount % 2 === 0 ? 0 : 0.001;
      callCount += 1;
      return val;
    });

    const result = await measureSequentialSpeedFromDir('/sparse/dir');
    expect(result.isHDD).toBe(false);
    expect(mockOpen).toHaveBeenCalledTimes(3);
    expect(mockFd.close).toHaveBeenCalled();
  });

  it('reads full file content and computes throughput', async () => {
    mockAccess.mockResolvedValue(undefined);
    const fileContent = Buffer.alloc(1024, 0xAB);
    const mockFd = makeMockFd({
      size: 1024,
      readFn: vi.fn().mockResolvedValue({ bytesRead: 1024, buffer: fileContent }),
    });
    mockOpen.mockResolvedValue(mockFd);

    let callCount = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      const val = callCount % 2 === 0 ? 0 : 0.1;
      callCount += 1;
      return val;
    });

    const result = await measureSequentialSpeedFromDir('/test/dir');
    expect(result.iopMBps).toBeGreaterThan(0);
    expect(mockFd.close).toHaveBeenCalled();
  });
});
