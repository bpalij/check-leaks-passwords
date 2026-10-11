import fs from 'fs';
import path from 'path';

import type { ConfigInterface, OutputConfig } from './types.js';
import { outputHandlers } from './handlers/index.js';

const validOutputFormats = Object.keys(outputHandlers);

/**
 * Validate a tool configuration object.
 *
 * Checks required fields, types, file existence, and output path
 * conflicts. Throws on any validation failure.
 *
 * @param config - The configuration to validate (read-only).
 * @throws {Error} If any configuration field is invalid or missing.
 */
export async function validateConfig(config: Readonly<ConfigInterface>): Promise<void> {
  if (typeof config.inputPath !== 'string' || !config.inputPath.trim()) {
    throw new Error('inputPath must be a non-empty string');
  }

  if (!config.useHibpApi) {
    if (typeof config.hashesOfLeaksPath !== 'string' || !config.hashesOfLeaksPath.trim()) {
      throw new Error(
        '"hashesOfLeaksPath" is required when useHibpApi is false'
        + ' — set it to the path of the HIBP hashes file or split-file directory,'
        + ' or set USE_HIBP_API=true to query the API directly',
      );
    }
  }

  if (!Array.isArray(config.outputs) || config.outputs.length === 0) {
    throw new Error('At least one output must be configured in config.outputs');
  }
  config.outputs.forEach((output: OutputConfig, i: number) => {
    if (!validOutputFormats.includes(output.format)) {
      throw new Error(
        `outputs[${i}].format "${output.format}" is invalid. Valid: ${validOutputFormats.join(', ')}`,
      );
    }
    if (typeof output.path !== 'string' || !output.path.trim()) {
      throw new Error(`outputs[${i}].path must be a non-empty string`);
    }
  });

  if (typeof config.useHibpApi !== 'boolean') {
    throw new Error('useHibpApi must be a boolean');
  }

  const validModes = [
    'auto',
    'sequential',
    'binary',
    'index',
  ];
  if (!validModes.includes(config.singleFileReadMode)) {
    throw new Error(`singleFileReadMode must be one of: ${validModes.join(', ')}`);
  }

  if (typeof config.buildIndex !== 'boolean') {
    throw new Error('buildIndex must be a boolean');
  }

  if (typeof config.includeSecrets !== 'boolean') {
    throw new Error('includeSecrets must be a boolean');
  }

  if (config.exportPassword !== undefined) {
    if (typeof config.exportPassword !== 'string' || !config.exportPassword.trim()) {
      throw new Error('exportPassword must be a non-empty string');
    }
  }

  if (config.hibpApiUrl !== undefined) {
    if (typeof config.hibpApiUrl !== 'string' || !config.hibpApiUrl.trim()) {
      throw new Error('hibpApiUrl must be a non-empty string');
    }
    if (!config.hibpApiUrl.endsWith('/')) {
      throw new Error('hibpApiUrl must end with a trailing slash (/)');
    }
    if (!config.hibpApiUrl.startsWith('https://')) {
      throw new Error('hibpApiUrl must use HTTPS');
    }
  }

  // File existence checks
  try {
    await fs.promises.stat(config.inputPath);
  } catch {
    throw new Error(`inputPath not found: ${config.inputPath}`);
  }

  if (!config.useHibpApi) {
    try {
      const stat = await fs.promises.stat(config.hashesOfLeaksPath);
      if (!stat.isFile() && !stat.isDirectory()) {
        throw new Error();
      }
    } catch {
      throw new Error(
        `hashesOfLeaksPath not found: ${config.hashesOfLeaksPath}\n`
        + 'Download the HIBP hashes file from https://haveibeenpwned.com/Passwords'
        + ' or point to a split-prefix directory.',
      );
    }
  }

  // Check output paths don't overlap with input
  const resolvedInput = path.resolve(config.inputPath);
  for (let i = 0; i < config.outputs.length; i += 1) {
    const resolvedOutput = path.resolve(config.outputs[i].path);
    if (resolvedInput === resolvedOutput) {
      throw new Error(
        `outputs[${i}].path "${config.outputs[i].path}" resolves to the same file as inputPath`
        + ` "${config.inputPath}" — this would overwrite your input. Use a different output path.`,
      );
    }
  }
}
