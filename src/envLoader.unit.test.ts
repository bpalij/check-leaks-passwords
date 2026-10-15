import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';

import { loadConfig } from './envLoader.js';

function makeEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    INPUT_PATH: '/tmp/input.csv',
    HASHES_OF_LEAKS_PATH: '/tmp/hashes.txt',
    OUTPUT_COUNT: '1',
    OUTPUT_0_FORMAT: 'csv',
    OUTPUT_0_PATH: '/tmp/out.csv',
    ...overrides,
  };
}

const BOOLEAN_TRUE_VALUES = [
  'true',
  '1',
  'yes',
  'TRUE',
  'Yes',
];
const BOOLEAN_FALSE_VALUES = [
  'false',
  '0',
  'no',
  'FALSE',
  'No',
];
const ENV_KEYS_TO_SAVE = [
  'INPUT_PATH',
  'HASHES_OF_LEAKS_PATH',
  'OUTPUT_COUNT',
  'OUTPUT_0_FORMAT',
  'OUTPUT_0_PATH',
  'OUTPUT_1_FORMAT',
  'OUTPUT_1_PATH',
  'USE_HIBP_API',
  'SINGLE_FILE_READ_MODE',
  'BUILD_INDEX',
  'INCLUDE_SECRETS',
  'EXPORT_PASSWORD',
  'HIBP_API_URL',
];

describe('loadConfig', () => {
  const savedEnv: Record<string, string | undefined> = {};
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    ENV_KEYS_TO_SAVE.forEach((key) => {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    });
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    Object.entries(savedEnv).forEach(([key, val]) => {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    });
    stderrSpy.mockRestore();
  });

  it('parses minimal required config', () => {
    const config = loadConfig(makeEnv());
    expect(config.inputPath).toBe('/tmp/input.csv');
    expect(config.hashesOfLeaksPath).toBe('/tmp/hashes.txt');
    expect(config.outputs).toHaveLength(1);
    expect(config.outputs[0]).toEqual({ format: 'csv', path: '/tmp/out.csv' });
    expect(config.useHibpApi).toBe(false);
    expect(config.singleFileReadMode).toBe('auto');
    expect(config.buildIndex).toBe(false);
    expect(config.includeSecrets).toBe(false);
    expect(config.exportPassword).toBeUndefined();
    expect(config.hibpApiUrl).toBeUndefined();
  });

  it('parses multiple outputs', () => {
    const config = loadConfig(makeEnv({
      OUTPUT_COUNT: '2',
      OUTPUT_0_FORMAT: 'csv',
      OUTPUT_0_PATH: '/tmp/a.csv',
      OUTPUT_1_FORMAT: 'json',
      OUTPUT_1_PATH: '/tmp/b.json',
    }));
    expect(config.outputs).toHaveLength(2);
    expect(config.outputs[0]).toEqual({ format: 'csv', path: '/tmp/a.csv' });
    expect(config.outputs[1]).toEqual({ format: 'json', path: '/tmp/b.json' });
  });

  it('applies defaults for optional fields', () => {
    const config = loadConfig(makeEnv());
    expect(config.useHibpApi).toBe(false);
    expect(config.singleFileReadMode).toBe('auto');
    expect(config.buildIndex).toBe(false);
    expect(config.includeSecrets).toBe(false);
  });

  it('warns and uses default for empty USE_HIBP_API', () => {
    const config = loadConfig(makeEnv({ USE_HIBP_API: '' }));
    expect(config.useHibpApi).toBe(false);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('USE_HIBP_API is empty, using default: false'),
    );
  });

  it('warns and uses default for empty SINGLE_FILE_READ_MODE', () => {
    const config = loadConfig(makeEnv({ SINGLE_FILE_READ_MODE: '' }));
    expect(config.singleFileReadMode).toBe('auto');
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('SINGLE_FILE_READ_MODE is empty, using default: auto'),
    );
  });

  it('warns and uses default for empty BUILD_INDEX', () => {
    const config = loadConfig(makeEnv({ BUILD_INDEX: '' }));
    expect(config.buildIndex).toBe(false);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('BUILD_INDEX is empty, using default: false'),
    );
  });

  it('warns and uses default for empty INCLUDE_SECRETS', () => {
    const config = loadConfig(makeEnv({ INCLUDE_SECRETS: '' }));
    expect(config.includeSecrets).toBe(false);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('INCLUDE_SECRETS is empty, using default: false'),
    );
  });

  it('does not warn when optional env vars are undefined', () => {
    loadConfig(makeEnv());
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('parses boolean true values', () => {
    BOOLEAN_TRUE_VALUES.forEach((val) => {
      const config = loadConfig(makeEnv({ USE_HIBP_API: val }));
      expect(config.useHibpApi).toBe(true);
    });
  });

  it('parses boolean false values', () => {
    BOOLEAN_FALSE_VALUES.forEach((val) => {
      const config = loadConfig(makeEnv({ USE_HIBP_API: val }));
      expect(config.useHibpApi).toBe(false);
    });
  });

  it('throws for invalid boolean', () => {
    expect(() => loadConfig(makeEnv({ USE_HIBP_API: 'maybe' })))
      .toThrow('Invalid boolean value');
  });

  it('parses singleFileReadMode', () => {
    const config = loadConfig(makeEnv({ SINGLE_FILE_READ_MODE: 'binary' }));
    expect(config.singleFileReadMode).toBe('binary');
  });

  it('throws for invalid singleFileReadMode', () => {
    expect(() => loadConfig(makeEnv({ SINGLE_FILE_READ_MODE: 'invalid' })))
      .toThrow('SINGLE_FILE_READ_MODE');
  });

  it('parses exportPassword', () => {
    const config = loadConfig(makeEnv({ EXPORT_PASSWORD: 'secret' }));
    expect(config.exportPassword).toBe('secret');
  });

  it('trims whitespace from exportPassword', () => {
    const config = loadConfig(makeEnv({ EXPORT_PASSWORD: '  secret  ' }));
    expect(config.exportPassword).toBe('secret');
  });

  it('omits exportPassword when empty', () => {
    const config = loadConfig(makeEnv({ EXPORT_PASSWORD: '   ' }));
    expect(config.exportPassword).toBeUndefined();
  });

  it('parses hibpApiUrl', () => {
    const config = loadConfig(makeEnv({ HIBP_API_URL: 'https://custom.api/range/' }));
    expect(config.hibpApiUrl).toBe('https://custom.api/range/');
  });

  it('omits hibpApiUrl when empty', () => {
    const config = loadConfig(makeEnv({ HIBP_API_URL: '' }));
    expect(config.hibpApiUrl).toBeUndefined();
  });

  it('throws when INPUT_PATH is missing', () => {
    expect(() => loadConfig(makeEnv({ INPUT_PATH: undefined })))
      .toThrow('INPUT_PATH is required');
  });

  it('throws when INPUT_PATH is empty', () => {
    expect(() => loadConfig(makeEnv({ INPUT_PATH: '   ' })))
      .toThrow('INPUT_PATH must not be empty');
  });

  it('throws when OUTPUT_COUNT is missing', () => {
    expect(() => loadConfig(makeEnv({ OUTPUT_COUNT: undefined })))
      .toThrow('OUTPUT_COUNT is required');
  });

  it('throws when OUTPUT_COUNT is not a positive integer', () => {
    expect(() => loadConfig(makeEnv({ OUTPUT_COUNT: '0' })))
      .toThrow('OUTPUT_COUNT must be a positive integer');
    expect(() => loadConfig(makeEnv({ OUTPUT_COUNT: 'abc' })))
      .toThrow('OUTPUT_COUNT must be a positive integer');
  });

  it('throws when OUTPUT_0_FORMAT is missing', () => {
    expect(() => loadConfig(makeEnv({ OUTPUT_0_FORMAT: undefined })))
      .toThrow('OUTPUT_0_FORMAT is required');
  });

  it('throws when OUTPUT_0_PATH is missing', () => {
    expect(() => loadConfig(makeEnv({ OUTPUT_0_PATH: undefined })))
      .toThrow('OUTPUT_0_PATH is required');
  });

  it('throws for invalid output format', () => {
    expect(() => loadConfig(makeEnv({ OUTPUT_0_FORMAT: 'xml' })))
      .toThrow('OUTPUT_0_FORMAT');
  });

  it('throws when HASHES_OF_LEAKS_PATH is missing and useHibpApi is false', () => {
    expect(() => loadConfig(makeEnv({
      USE_HIBP_API: 'false',
      HASHES_OF_LEAKS_PATH: undefined,
    }))).toThrow('HASHES_OF_LEAKS_PATH is required');
  });

  it('allows missing HASHES_OF_LEAKS_PATH when useHibpApi is true', () => {
    const config = loadConfig(makeEnv({
      USE_HIBP_API: 'true',
      HASHES_OF_LEAKS_PATH: undefined,
    }));
    expect(config.useHibpApi).toBe(true);
    expect(config.hashesOfLeaksPath).toBe('');
  });

  it('defaults HASH_TYPE to auto and HASH_TYPE_MISMATCH to error', () => {
    const config = loadConfig(makeEnv());
    expect(config.hashType).toBe('auto');
    expect(config.hashTypeMismatch).toBe('error');
  });

  it.each([
    'auto',
    'sha1',
    'ntlm',
  ])('accepts HASH_TYPE=%s', (value) => {
    expect(loadConfig(makeEnv({ HASH_TYPE: value })).hashType).toBe(value);
  });

  it.each(['error', 'warn'])('accepts HASH_TYPE_MISMATCH=%s', (value) => {
    expect(loadConfig(makeEnv({ HASH_TYPE_MISMATCH: value })).hashTypeMismatch).toBe(value);
  });

  it('rejects an invalid HASH_TYPE naming valid options', () => {
    expect(() => loadConfig(makeEnv({ HASH_TYPE: 'md5' })))
      .toThrow('HASH_TYPE="md5" is invalid. Valid: auto, sha1, ntlm');
  });

  it('rejects an invalid HASH_TYPE_MISMATCH naming valid options', () => {
    expect(() => loadConfig(makeEnv({ HASH_TYPE_MISMATCH: 'ignore' })))
      .toThrow('HASH_TYPE_MISMATCH="ignore" is invalid. Valid: error, warn');
  });
});
