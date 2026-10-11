import path from 'path';

import {
  describe, it, expect, vi, afterEach, beforeEach,
} from 'vitest';

import { FIXTURES_DIR } from './helpers/fixturesDir.js';

const fixturesDir = FIXTURES_DIR;

const mockState = vi.hoisted(() => ({
  mockStart: vi.fn(),
  mockUpdate: vi.fn(),
  mockStop: vi.fn(),
}));

vi.mock('cli-progress', () => ({
  SingleBar: class MockSingleBar {
    start = mockState.mockStart;

    update = mockState.mockUpdate;

    stop = mockState.mockStop;
  },
}));

vi.mock('../src/io/processDataLeaks.js', () => ({
  processDataLeaks: vi.fn().mockImplementation(
    async (
      _hashes: unknown,
      _path: unknown,
      _encoding: unknown,
      _log: unknown,
      onProgress?: (update: {
        current: number; total: number; speed: number; phase: string; format: string;
      }) => void,
    ) => {
      onProgress?.({
        current: 100,
        total: 200,
        speed: 50,
        phase: 'Scan file',
        format: 'bytes',
      });
      throw new Error('scan failed');
    },
  ),
}));

const mockInputHandler = vi.fn();

vi.mock('../src/handlers/index.js', () => ({
  inputHandlers: { csv: mockInputHandler, json: mockInputHandler },
  outputHandlers: { json: vi.fn(), csv: vi.fn() },
}));

let checkPasswordsLeaks: typeof import('../src/checkPasswordsLeaks.js').checkPasswordsLeaks;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('../src/checkPasswordsLeaks.js');
  checkPasswordsLeaks = mod.checkPasswordsLeaks;
  mockInputHandler.mockReset();
  mockState.mockStart.mockClear();
  mockState.mockUpdate.mockClear();
  mockState.mockStop.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checkPasswordsLeaks — empty input handler', () => {
  it('calls readSpinner.fail when handler returns [] without calling callback', async () => {
    mockInputHandler.mockImplementation(async () => []);

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await expect(
        checkPasswordsLeaks({
          inputPath: path.join(fixturesDir, 'sample.csv'),
          hashesOfLeaksPath: path.join(fixturesDir, 'empty-hashes.txt'),
          useHibpApi: false,
          singleFileReadMode: 'auto',
          buildIndex: false,
          includeSecrets: true,
          outputs: [{ format: 'json', path: '/tmp/would-not-exist.json' }],
        }),
      ).rejects.toThrow('No non-empty passwords found');

      const output = writeSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('No non-empty passwords found');
    } finally {
      writeSpy.mockRestore();
    }
  });

  it('does not call readSpinner.fail when handler returns [] AND calls callback', async () => {
    mockInputHandler.mockImplementation(
      async (_p: string, _pw: string, onComplete?: () => void) => {
        onComplete?.();
        return [];
      },
    );

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await expect(
        checkPasswordsLeaks({
          inputPath: path.join(fixturesDir, 'sample.csv'),
          hashesOfLeaksPath: path.join(fixturesDir, 'empty-hashes.txt'),
          useHibpApi: false,
          singleFileReadMode: 'auto',
          buildIndex: false,
          includeSecrets: true,
          outputs: [{ format: 'json', path: '/tmp/would-not-exist.json' }],
        }),
      ).rejects.toThrow('No non-empty passwords found');

      const output = writeSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).not.toContain('No non-empty passwords found in the input file');
    } finally {
      writeSpy.mockRestore();
    }
  });
});

describe('makePhase error path', () => {
  it('stops progress bar and rethrows when scanning phase throws', async () => {
    mockInputHandler.mockImplementation(
      async (_p: string, _pw: string, onComplete?: () => void) => {
        onComplete?.();
        return [{ login_password: 'testpass' }];
      },
    );

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      await expect(
        checkPasswordsLeaks({
          inputPath: path.join(fixturesDir, 'sample.csv'),
          hashesOfLeaksPath: path.join(fixturesDir, 'sample-hashes.txt'),
          useHibpApi: false,
          singleFileReadMode: 'auto',
          buildIndex: false,
          includeSecrets: true,
          outputs: [{ format: 'json', path: '/tmp/would-not-exist.json' }],
        }),
      ).rejects.toThrow('scan failed');

      expect(mockState.mockStop).toHaveBeenCalled();
    } finally {
      writeSpy.mockRestore();
    }
  });
});
