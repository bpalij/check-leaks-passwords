import type {
  ConfigInterface, OutputConfig, SingleFileReadMode,
} from './types.js';
import { ENV_DEFAULTS } from './envDefaults.js';

const VALID_OUTPUT_FORMATS = ['csv', 'json'];
const VALID_READ_MODES: readonly SingleFileReadMode[] = [
  'auto',
  'sequential',
  'binary',
  'index',
];

/**
 * Write a warning message to stderr.
 *
 * @param message - The warning message to display.
 */
function warn(message: string): void {
  process.stderr.write(`Warning: ${message}\n`);
}

/**
 * Parse a boolean environment variable with a fallback default.
 *
 * Accepts "true", "1", "yes" as true and "false", "0", "no" as false.
 *
 * @param value - The raw environment variable value.
 * @param defaultValue - The fallback value when undefined or empty.
 * @param envName - The environment variable name (for error messages).
 * @returns The parsed boolean value.
 * @throws {Error} If the value is non-empty and not a valid boolean string.
 */
function parseBoolean(value: string | undefined, defaultValue: boolean, envName: string): boolean {
  if (value === undefined || value === '') {
    if (value === '') warn(`${envName} is empty, using default: ${defaultValue}`);
    return defaultValue;
  }
  const lower = value.toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes') return true;
  if (lower === 'false' || lower === '0' || lower === 'no') return false;
  throw new Error(`Invalid boolean value: "${value}" (expected true/false)`);
}

/**
 * Parse an enum environment variable with a fallback default.
 *
 * @template T - The enum type.
 * @param value - The raw environment variable value.
 * @param validValues - The set of valid enum values.
 * @param defaultValue - The fallback value when undefined or empty.
 * @param envName - The environment variable name (for error messages).
 * @returns The parsed enum value.
 * @throws {Error} If the value is non-empty and not in validValues.
 */
function parseEnum<T extends string>(
  value: string | undefined,
  validValues: readonly T[],
  defaultValue: T,
  envName: string,
): T {
  if (value === undefined || value === '') {
    if (value === '') warn(`${envName} is empty, using default: ${defaultValue}`);
    return defaultValue;
  }
  if (validValues.includes(value as T)) return value as T;
  throw new Error(`${envName}="${value}" is invalid. Valid: ${validValues.join(', ')}`);
}

/**
 * Require a non-empty string environment variable.
 *
 * @param value - The raw environment variable value.
 * @param envName - The environment variable name (for error messages).
 * @returns The trimmed string value.
 * @throws {Error} If the value is undefined or empty.
 */
function requireString(value: string | undefined, envName: string): string {
  if (value === undefined) throw new Error(`${envName} is required`);
  if (!value.trim()) throw new Error(`${envName} must not be empty`);
  return value.trim();
}

/**
 * Parse the OUTPUT_COUNT and OUTPUT_{i}_FORMAT/OUTPUT_{i}_PATH env vars.
 *
 * @param env - The environment variables to read from.
 * @returns Array of OutputConfig objects.
 * @throws {Error} If OUTPUT_COUNT or any output config is missing or invalid.
 */
function parseOutputs(env: NodeJS.ProcessEnv): OutputConfig[] {
  const countRaw = env.OUTPUT_COUNT;
  if (countRaw === undefined) {
    throw new Error('OUTPUT_COUNT is required');
  }
  const count = parseInt(countRaw, 10);
  if (!Number.isFinite(count) || count < 1) {
    throw new Error(`OUTPUT_COUNT must be a positive integer, got "${countRaw}"`);
  }

  const outputs: OutputConfig[] = [];
  for (let i = 0; i < count; i += 1) {
    const formatRaw = env[`OUTPUT_${i}_FORMAT`];
    const pathRaw = env[`OUTPUT_${i}_PATH`];

    if (formatRaw === undefined) {
      throw new Error(`OUTPUT_${i}_FORMAT is required`);
    }
    if (!formatRaw.trim()) {
      throw new Error(`OUTPUT_${i}_FORMAT must not be empty`);
    }
    if (pathRaw === undefined) {
      throw new Error(`OUTPUT_${i}_PATH is required`);
    }
    if (!pathRaw.trim()) {
      throw new Error(`OUTPUT_${i}_PATH must not be empty`);
    }
    if (!VALID_OUTPUT_FORMATS.includes(formatRaw)) {
      throw new Error(
        `OUTPUT_${i}_FORMAT="${formatRaw}" is invalid. Valid: ${VALID_OUTPUT_FORMATS.join(', ')}`,
      );
    }

    outputs.push({ format: formatRaw as 'csv' | 'json', path: pathRaw.trim() });
  }

  return outputs;
}

/**
 * Load tool configuration from environment variables.
 *
 * Merges environment variables with defaults, validates required fields,
 * and returns a fully resolved ConfigInterface.
 *
 * @param env - The environment to read from (defaults to process.env).
 * @returns A validated ConfigInterface with all fields resolved.
 * @throws {Error} If required environment variables are missing or invalid.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConfigInterface {
  const inputPath = requireString(env.INPUT_PATH, 'INPUT_PATH');
  const outputs = parseOutputs(env);

  const useHibpApi = parseBoolean(env.USE_HIBP_API, ENV_DEFAULTS.USE_HIBP_API, 'USE_HIBP_API');
  const hashesOfLeaksPath = useHibpApi
    ? (env.HASHES_OF_LEAKS_PATH?.trim() ?? '')
    : requireString(env.HASHES_OF_LEAKS_PATH, 'HASHES_OF_LEAKS_PATH');

  const singleFileReadMode = parseEnum(
    env.SINGLE_FILE_READ_MODE,
    VALID_READ_MODES,
    ENV_DEFAULTS.SINGLE_FILE_READ_MODE,
    'SINGLE_FILE_READ_MODE',
  );

  const buildIndex = parseBoolean(env.BUILD_INDEX, ENV_DEFAULTS.BUILD_INDEX, 'BUILD_INDEX');
  const includeSecrets = parseBoolean(env.INCLUDE_SECRETS, ENV_DEFAULTS.INCLUDE_SECRETS, 'INCLUDE_SECRETS');

  const exportPassword = env.EXPORT_PASSWORD?.trim() || undefined;
  const hibpApiUrl = env.HIBP_API_URL?.trim() || undefined;

  return {
    inputPath,
    hashesOfLeaksPath,
    outputs,
    useHibpApi,
    singleFileReadMode,
    buildIndex,
    includeSecrets,
    exportPassword,
    hibpApiUrl,
  };
}
