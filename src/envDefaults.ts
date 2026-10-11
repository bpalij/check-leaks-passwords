import type { SingleFileReadMode } from './types.js';

/**
 * Default values for environment variable configuration.
 *
 * Used as fallbacks when corresponding environment variables are not set.
 */
export const ENV_DEFAULTS = {
  /** Use HIBP API instead of local file scanning. */
  USE_HIBP_API: false,
  /** Automatic read mode selection based on file size and sortedness. */
  SINGLE_FILE_READ_MODE: 'auto' as SingleFileReadMode,
  /** Do not build index files by default. */
  BUILD_INDEX: false,
  /** Do not include plaintext secrets in output by default. */
  INCLUDE_SECRETS: false,
  /** Default HIBP API base URL. */
  HIBP_API_URL: 'https://api.pwnedpasswords.com/range/',
} as const;
