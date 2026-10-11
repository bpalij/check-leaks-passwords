import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import {
  describe, it, expect, vi, afterEach,
} from 'vitest';

import { validateConfig } from './validateConfig.js';
import type { ConfigInterface } from './types.js';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

const validConfig: Readonly<ConfigInterface> = {
  inputPath: currentFile,
  hashesOfLeaksPath: currentFile,
  useHibpApi: false,
  singleFileReadMode: 'auto',
  buildIndex: false,
  includeSecrets: false,
  outputs: [{ format: 'csv', path: path.join(currentDir, '__output__', 'out.csv') }],
};

describe('validateConfig', () => {
  it('passes for valid config', async () => {
    await expect(validateConfig(validConfig)).resolves.toBeUndefined();
  });

  it('passes with useHibpApi: true and no hashesOfLeaksPath', async () => {
    await expect(validateConfig(
      { ...validConfig, useHibpApi: true } as ConfigInterface,
    )).resolves.toBeUndefined();
  });

  it('throws if inputPath is empty', async () => {
    await expect(validateConfig({ ...validConfig, inputPath: '' })).rejects.toThrow('inputPath must be a non-empty string');
    await expect(validateConfig({ ...validConfig, inputPath: '  ' })).rejects.toThrow('inputPath must be a non-empty string');
  });

  it('throws if inputPath does not exist', async () => {
    await expect(validateConfig({ ...validConfig, inputPath: '/nonexistent/file.csv' })).rejects.toThrow('inputPath not found');
  });

  it('throws if hashesOfLeaksPath is empty when useHibpApi is false', async () => {
    await expect(validateConfig({ ...validConfig, hashesOfLeaksPath: '' })).rejects.toThrow('"hashesOfLeaksPath" is required');
    await expect(validateConfig({ ...validConfig, hashesOfLeaksPath: '  ' })).rejects.toThrow('"hashesOfLeaksPath" is required');
  });

  it('throws if outputs is empty', async () => {
    await expect(validateConfig({ ...validConfig, outputs: [] })).rejects.toThrow('At least one output must be configured');
  });

  it('throws if output path is empty', async () => {
    await expect(validateConfig({ ...validConfig, outputs: [{ format: 'csv', path: '' }] })).rejects.toThrow('outputs[0].path must be a non-empty string');
    await expect(validateConfig({ ...validConfig, outputs: [{ format: 'csv', path: '  ' }] })).rejects.toThrow('outputs[0].path must be a non-empty string');
  });

  it('throws if output format is unknown', async () => {
    await expect(validateConfig({ ...validConfig, outputs: [{ format: 'xml' as 'csv', path: currentFile }] })).rejects.toThrow('outputs[0].format');
  });

  it('throws if useHibpApi is not a boolean', async () => {
    await expect(validateConfig({ ...validConfig, useHibpApi: 1 as never })).rejects.toThrow('useHibpApi must be a boolean');
  });

  it('throws if singleFileReadMode is invalid', async () => {
    await expect(validateConfig({ ...validConfig, singleFileReadMode: 'invalid' as never })).rejects.toThrow('singleFileReadMode must be one of');
  });

  it('throws if buildIndex is not a boolean', async () => {
    await expect(validateConfig({ ...validConfig, buildIndex: 1 as never })).rejects.toThrow('buildIndex must be a boolean');
  });

  it('throws if includeSecrets is not a boolean', async () => {
    await expect(validateConfig({ ...validConfig, includeSecrets: 1 as never })).rejects.toThrow('includeSecrets must be a boolean');
  });

  it('throws if hashesOfLeaksPath stat is neither file nor directory', async () => {
    const originalStat = fs.promises.stat;
    try {
      vi.spyOn(fs.promises, 'stat').mockImplementation(async (p) => {
        if (p === validConfig.hashesOfLeaksPath) {
          return { isFile: () => false, isDirectory: () => false } as fs.Stats;
        }
        return originalStat(p as fs.PathLike);
      });
      await expect(validateConfig(validConfig)).rejects.toThrow('hashesOfLeaksPath not found');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('throws if output path resolves to same file as inputPath', async () => {
    await expect(
      validateConfig({
        ...validConfig,
        outputs: [{ format: 'csv', path: validConfig.inputPath }],
      }),
    ).rejects.toThrow('resolves to the same file as inputPath');
  });

  it('throws if exportPassword is not a string', async () => {
    await expect(
      validateConfig({ ...validConfig, exportPassword: 123 as never }),
    ).rejects.toThrow('exportPassword must be a non-empty string');
  });

  it('throws if exportPassword is whitespace only', async () => {
    await expect(
      validateConfig({ ...validConfig, exportPassword: '   ' }),
    ).rejects.toThrow('exportPassword must be a non-empty string');
  });

  it('throws if hibpApiUrl is not a string', async () => {
    await expect(
      validateConfig({ ...validConfig, hibpApiUrl: 123 as unknown as string }),
    ).rejects.toThrow('hibpApiUrl must be a non-empty string');
  });

  it('throws if hibpApiUrl is empty', async () => {
    await expect(
      validateConfig({ ...validConfig, hibpApiUrl: '' }),
    ).rejects.toThrow('hibpApiUrl must be a non-empty string');
    await expect(
      validateConfig({ ...validConfig, hibpApiUrl: '  ' }),
    ).rejects.toThrow('hibpApiUrl must be a non-empty string');
  });

  it('throws if hibpApiUrl missing trailing slash', async () => {
    await expect(
      validateConfig({ ...validConfig, hibpApiUrl: 'https://api.example.com/range' }),
    ).rejects.toThrow('hibpApiUrl must end with a trailing slash');
  });

  it('throws if hibpApiUrl does not use HTTPS', async () => {
    await expect(
      validateConfig({ ...validConfig, hibpApiUrl: 'http://api.example.com/range/' }),
    ).rejects.toThrow('hibpApiUrl must use HTTPS');
  });

  it('passes with valid hibpApiUrl ending in slash', async () => {
    await expect(
      validateConfig({ ...validConfig, hibpApiUrl: 'https://api.example.com/range/' }),
    ).resolves.toBeUndefined();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
