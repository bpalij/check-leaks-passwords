import { describe, it, expect } from 'vitest';
import validateConfig from '../config/validateConfig';
import type { configInterface } from '../config/configInterface';

const validConfig: Readonly<configInterface> = {
  inputPath: '/some/path.csv',
  inputFormat: 'csv',
  hashesOfLeaksPath: '/some/hashes.txt',
  useHibpApi: false,
  outputs: [
    { format: 'csv', path: '/output/out.csv' },
  ],
};

describe('validateConfig', () => {
  it('passes for valid config', () => {
    expect(() => validateConfig(validConfig)).not.toThrow();
  });

  it('passes with useHibpApi: true and no hashesOfLeaksPath', () => {
    expect(() => validateConfig({ ...validConfig, useHibpApi: true, hashesOfLeaksPath: '' })).not.toThrow();
  });

  it('throws if inputPath is empty', () => {
    expect(() => validateConfig({ ...validConfig, inputPath: '' })).toThrow('inputPath must be a non-empty string');
    expect(() => validateConfig({ ...validConfig, inputPath: '  ' })).toThrow('inputPath must be a non-empty string');
  });

  it('throws if inputFormat is unknown', () => {
    expect(() => validateConfig({ ...validConfig, inputFormat: 'xml' as 'csv' })).toThrow('Unknown inputFormat');
  });

  it('throws if hashesOfLeaksPath is empty when useHibpApi is false', () => {
    expect(() => validateConfig({ ...validConfig, hashesOfLeaksPath: '' })).toThrow('hashesOfLeaksPath must be a non-empty string');
    expect(() => validateConfig({ ...validConfig, hashesOfLeaksPath: '  ' })).toThrow('hashesOfLeaksPath must be a non-empty string');
  });

  it('throws if outputs is empty', () => {
    expect(() => validateConfig({ ...validConfig, outputs: [] })).toThrow('At least one output must be configured');
  });

  it('throws if output format is unknown', () => {
    expect(() => validateConfig({ ...validConfig, outputs: [{ format: 'xml' as 'csv', path: '/out' }] })).toThrow('outputs[0].format');
  });

  it('throws if output path is empty', () => {
    expect(() => validateConfig({ ...validConfig, outputs: [{ format: 'csv', path: '' }] })).toThrow('outputs[0].path must be a non-empty string');
    expect(() => validateConfig({ ...validConfig, outputs: [{ format: 'csv', path: '  ' }] })).toThrow('outputs[0].path must be a non-empty string');
  });

  it('throws if useHibpApi is not a boolean', () => {
    expect(() => validateConfig({ ...validConfig, useHibpApi: 1 as never })).toThrow('useHibpApi must be a boolean');
  });
});
