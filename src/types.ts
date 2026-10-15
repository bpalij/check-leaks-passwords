/**
 * Bitwarden CSV export row with flat login fields (login_password, login_uris, etc.).
 *
 * Fields are named with `login_` prefix to match the CSV column convention.
 * All fields except `login_password` are optional — CSV rows may be incomplete.
 */
export interface FlatPasswordObject {
  login_password: string;
  folderName?: string;
  login_uris?: string[];
  login_username?: string;
  login_totp?: string;
  type?: number;
  typeLabel?: string;
  reprompt?: number;
  repromptLabel?: string;
  passwordAgeDays?: number;
  hasTotp?: boolean;
  hasPasskey?: boolean;
  uriCount?: number;
  hasCustomFields?: boolean;
  organizationId?: string;
  revisionDate?: string;
  creationDate?: string;
  deletedDate?: string;
  name?: string;
  notes?: string;
  favorite?: boolean;
  archivedDate?: string;
  [key: string]: unknown;
}

/**
 * Bitwarden JSON export item with nested `login` object.
 *
 * Mirrors the Bitwarden vault export JSON schema. The `login` property
 * contains the password, username, URIs, TOTP, and FIDO2 credentials.
 */
export interface NestedPasswordObject {
  id?: string;
  folderId?: string;
  folderName?: string;
  organizationId?: string;
  collectionIds?: string[];
  favorite: boolean;
  type: number;
  typeLabel: string;
  name?: string;
  notes?: string | null;
  fields?: Array<Record<string, unknown>> | null;
  reprompt: number;
  repromptLabel: string;
  revisionDate?: string;
  creationDate?: string;
  deletedDate?: string | null;
  archivedDate?: string | null;
  passwordHistory?: Array<Record<string, unknown>> | null;
  passwordAgeDays?: number;
  hasTotp?: boolean;
  hasPasskey?: boolean;
  uriCount?: number;
  hasCustomFields?: boolean;
  login: {
    password: string;
    username?: string | null;
    uris?: Array<{ uri?: string; match?: number | null }> | null;
    totp?: string | null;
    fido2Credentials?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
}

/**
 * Union of flat (CSV) and nested (JSON) password object formats.
 *
 * Discriminate with `'login' in obj` to determine which variant.
 */
export type PasswordObject = FlatPasswordObject | NestedPasswordObject;

/**
 * A password object paired with its SHA-1 hex hash.
 *
 * Used during the hashing phase before the hash map is built.
 */
export interface PasswordObjectWithHash {
  hash: string;
  passwordObject: PasswordObject;
}

/**
 * A SHA-1 hash with all password objects that share that hash.
 *
 * Multiple vault entries can have the same password — this groups them.
 */
export interface HashWithPasswordObjects {
  hash: string;
  passwordObjects: Array<PasswordObject>;
}

/**
 * A hash lookup entry containing the full hash string and its byte representation.
 *
 * `fullHashBytes` holds the first `fullHashLength` bytes of the hash (40 for
 * SHA-1, 32 for NTLM) for fast comparison in the hot path (parseBuffer).
 */
export interface HashLookupEntry {
  fullHash: string;
  fullHashBytes: Buffer;
}

/**
 * A hash with its leak count and all associated password objects.
 *
 * This is the final enriched result format written to output.
 */
export interface HashWithLeaksAndPasswordObjects extends HashWithPasswordObjects {
  leaks: number;
}

/**
 * Progress update emitted during scanning phases.
 *
 * @property current - Bytes, lines, or hashes processed so far.
 * @property total - Total bytes, lines, or hashes to process.
 * @property speed - Processing speed (bytes/s, lines/s, or hashes/s).
 * @property workers - Number of concurrent workers active.
 * @property phase - Human-readable phase name for display.
 * @property format - Number formatting hint for the progress bar.
 */
export interface ProgressUpdate {
  current: number;
  total: number;
  speed?: number;
  workers?: number;
  phase?: string;
  format?: 'number' | 'bytes' | 'compact';
}

/**
 * Callback type for progress updates during scanning.
 *
 * @param update - The current progress state.
 */
export type OnProgress = (update: ProgressUpdate) => void;

/**
 * Options for output handlers (CSV/JSON writers).
 *
 * @property includeSecrets - When true, plaintext passwords and TOTP secrets
 *   are included in the output. ⚠️ INSECURE — secrets written to disk.
 * @property hashType - Effective hash type for the run, written per record as
 *   `login_password_hash_type`. Defaults to `sha1` when omitted.
 */
export type OutputHandlerOptions = {
  /** Whether to include plaintext secrets in the output. Defaults to false. */
  includeSecrets?: boolean;
  /** Effective hash type actually used for matching (reflects self-correction). */
  hashType?: 'sha1' | 'ntlm';
};

/**
 * Tri-state outcome of the sortedness check.
 *
 * - `sorted`: corpus >= 1 GiB and verified ordered (live check or fresh V3
 *   `.idx` cache hit); enables order-dependent reading (binary/index) and
 *   `.idx` builds.
 * - `unsorted`: corpus >= 1 GiB and verified not ordered; `.idx` unlinked,
 *   sequential read only.
 * - `skipped`: corpus < 1 GiB — the check does not run, so no sorted/unsorted
 *   claim is made (FR-014). Applies the same fallback as `unsorted` (`.idx`
 *   unlinked, sequential read only) but never enables order-dependent reading.
 */
export type SortednessVerdict = 'sorted' | 'unsorted' | 'skipped';

/**
 * Read mode for single-file HIBP processing.
 *
 * - `auto`: Automatically select the best mode based on file characteristics.
 * - `sequential`: Stream the file from start to end.
 * - `binary`: Binary search for each hash in the sorted file.
 * - `index`: Use a pre-built `.idx` file for O(1) prefix lookups.
 */
export type SingleFileReadMode = | 'auto'
  | 'sequential'
  | 'binary'
  | 'index';

/**
 * Forced read mode override (from READ_MODE_FORCED env var).
 *
 * Bypasses auto-detection. Requires sorted file for binary/index modes.
 */
export type ForcedReadMode = | 'binary'
  | 'index'
  | 'sequential-noindex'
  | 'sequential-index';

/**
 * Hash algorithm selection for password lookups.
 *
 * - `sha1`: SHA-1 (hex, uppercase) — the historical default.
 * - `ntlm`: MD4 of the UTF-16LE-encoded password (hex, uppercase).
 * - `auto`: Detect the algorithm from corpus content (default). Never an
 *   effective (resolved) value — resolution always yields `'sha1' | 'ntlm'`.
 */
export type HashType = 'sha1' | 'ntlm' | 'auto';

/**
 * Governance mode when the requested hash type conflicts with the detected type.
 *
 * - `error`: abort before scanning, naming the requested and detected types.
 * - `warn`: emit a prominent warning and self-correct to the detected type.
 */
export type HashTypeMismatchMode = 'error' | 'warn';

/**
 * Canonical runtime hash-type information for a single run.
 *
 * Produced by the hash-type resolution step and threaded through every
 * processing path. The effective `type` is always concrete (`sha1` or `ntlm`);
 * `requested` preserves the original (possibly `auto`) request.
 */
export interface ActiveHashInfo {
  /** The originally requested hash type (may be `auto`). */
  requested: HashType;
  /** The effective hash type actually used for hashing and corpus matching. */
  type: 'sha1' | 'ntlm';
  /** Full hex length of the effective hash (40 for sha1, 32 for ntlm). */
  fullHashLength: number;
  /** Suffix hex length returned by the HIBP API / stored in split files (35 or 27). */
  apiSuffixLength: number;
  /**
   * How the effective type was chosen:
   * - `explicit`: the user requested this exact type.
   * - `detected`: auto-detected from local corpus content.
   * - `corrected`: warn-mode self-correction from a mismatched requested type.
   * - `api-default`: `auto` resolved to sha1 because API mode has no corpus to sample.
   */
  source: 'explicit' | 'detected' | 'corrected' | 'api-default';
  /** The active mismatch governance mode. */
  mismatchMode: HashTypeMismatchMode;
}

/**
 * Output configuration — format and file path.
 *
 * @property format - Output format: 'csv' or 'json'.
 * @property path - File path to write the output to.
 */
export interface OutputConfig {
  format: 'csv' | 'json';
  path: string;
}

/**
 * Full tool configuration loaded from environment variables and CLI args.
 *
 * All fields are validated by `validateConfig()` before use.
 */
export interface ConfigInterface {
  inputPath: string;
  hashesOfLeaksPath: string;
  outputs: Array<OutputConfig>;
  useHibpApi: boolean;
  /** Requested hash algorithm (`auto` detects from corpus). Defaults to `auto`. */
  hashType?: HashType;
  /** Mismatch behavior vs. detected corpus type. Defaults to `error`. */
  hashTypeMismatch?: HashTypeMismatchMode;
  singleFileReadMode: SingleFileReadMode;
  buildIndex: boolean;
  /** Include plaintext passwords, TOTP secrets, password history, and FIDO2 credentials in output.
   *  ⚠️ INSECURE when true — secrets are written to disk as plaintext. Default: false (secure). */
  includeSecrets: boolean;
  exportPassword?: string;
  hibpApiUrl?: string;
}
