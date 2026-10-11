import fs from 'fs';
import os from 'os';

import { vi } from 'vitest';

import { determineOptimalChunkCount } from './determineOptimalChunkCount.js';

vi.mock('../memory/getAvailableMemBytes', () => ({
  getAvailableMemBytes: () => 8192 * 1024 * 1024,
}));

vi.mock('../constants', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    HIGH_WATER_MARK: 16 * 1024 * 1024,
  };
});

function mockDrive(perReadElapsedMs: number): void {
  const stat = vi.fn().mockResolvedValue({ size: 1024 * 1024 * 1024 });
  const read = vi.fn(() => Promise.resolve({ bytesRead: 0, buffer: Buffer.alloc(0) }));
  const close = vi.fn().mockResolvedValue(undefined);
  const mockFd = {
    fd: 123,
    stat,
    read,
    close,
    async [Symbol.asyncDispose]() { await this.close(); },
  } as never;
  vi.spyOn(fs.promises, 'open').mockResolvedValue(mockFd);
  let now = 0;
  const mockNow = () => {
    const prev = now;
    now += perReadElapsedMs;
    return prev;
  };
  vi.spyOn(Date, 'now').mockImplementation(mockNow);
  vi.spyOn(performance, 'now').mockImplementation(mockNow);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('determineOptimalChunkCount', () => {
  it('returns 1 chunk for file under threshold, preCheckSkipped=true', async () => {
    const result = await determineOptimalChunkCount('/fake', 128 * 1024 * 1024);
    expect(result.chunkCount).toBe(1);
    expect(result.preCheckSkipped).toBe(true);
    expect(result.testDurationMs).toBe(0);
  });

  it('returns 1 chunk for HDD (slow sequential speed)', async () => {
    mockDrive(900);
    vi.spyOn(os, 'freemem').mockReturnValue(8 * 1024 ** 3);
    vi.spyOn(os, 'availableParallelism').mockReturnValue(16);

    const result = await determineOptimalChunkCount('/fake', 6 * 1024 * 1024 * 1024);
    expect(result.chunkCount).toBe(1);
    expect(result.isHDD).toBe(true);
    expect(result.preCheckSkipped).toBe(false);
    expect(result.iopMBps).toBeGreaterThan(0);
    expect(result.testDurationMs).toBeGreaterThan(0);
  });

  it('returns ideal chunk count for fast drive', async () => {
    mockDrive(1);
    vi.spyOn(os, 'freemem').mockReturnValue(8 * 1024 ** 3);
    vi.spyOn(os, 'availableParallelism').mockReturnValue(16);

    const result = await determineOptimalChunkCount('/fake', 6 * 1024 * 1024 * 1024);
    expect(result.chunkCount).toBe(16);
    expect(result.isHDD).toBe(false);
  });

  it('respects memory cap on very low RAM', async () => {
    mockDrive(1);
    vi.spyOn(os, 'freemem').mockReturnValue(1024 * 1024 * 1024);
    vi.spyOn(os, 'availableParallelism').mockReturnValue(16);

    const result = await determineOptimalChunkCount('/fake', 6 * 1024 * 1024 * 1024);
    expect(result.chunkCount).toBe(16);
  });

  it('respects CPU cap from availableParallelism', async () => {
    mockDrive(1);
    vi.spyOn(os, 'freemem').mockReturnValue(8 * 1024 ** 3);
    vi.spyOn(os, 'availableParallelism').mockReturnValue(2);

    const result = await determineOptimalChunkCount('/fake', 6 * 1024 * 1024 * 1024);
    expect(result.chunkCount).toBe(2);
  });

  it('handles zero elapsed time by falling back to 0.001ms floor', async () => {
    mockDrive(0);
    vi.spyOn(os, 'freemem').mockReturnValue(8 * 1024 ** 3);
    vi.spyOn(os, 'availableParallelism').mockReturnValue(16);

    const result = await determineOptimalChunkCount('/fake', 6 * 1024 * 1024 * 1024);
    expect(result.testDurationMs).toBeCloseTo(0.003);
    expect(result.preCheckSkipped).toBe(false);
    expect(result.chunkCount).toBe(16);
  });
});
