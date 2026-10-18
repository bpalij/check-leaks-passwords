/**
 * Default high water mark for read buffers (16 MB).
 *
 * Controls the size of each read buffer in the read-ahead ring.
 * Configurable via the HIGH_WATER_MARK environment variable.
 */
export const HIGH_WATER_MARK = 16 * 1024 * 1024;

/** Length of a SHA-1 hex hash prefix used for HIBP file lookups (5 characters). */
export const HASH_PREFIX_LENGTH = 5;

/** Base URL for the HIBP Passwords API (k-anonymity range endpoint). */
export const HIBP_API_URL = 'https://api.pwnedpasswords.com/range/';

/** Size of the sequential read test for drive speed detection (16 MB). */
export const DRIVE_SPEED_TEST_SIZE = 16 * 1024 * 1024;

/** MB/s per chunk — used to calculate chunk count from drive speed. */
export const MBPS_PER_CHUNK = 300;

/**
 * "Small file" cutoff in bytes (1 GiB).
 *
 * Files below it skip the drive speed test / use a single chunk, and the
 * sortedness check returns `skipped`. Overridable at runtime via the
 * `SMALL_FILE_BYTES_THRESHOLD` environment variable (or `--small-file-threshold`).
 */
export const SMALL_FILE_BYTES_THRESHOLD = 1 * 1024 * 1024 * 1024;

/** Overlap in bytes between adjacent chunks to handle cross-boundary lines. */
export const CHUNK_OVERLAP = 256;

/** Maximum number of parallel chunks for single-file processing. */
export const MAX_CHUNKS = 128;

/** Default number of read-ahead streams per chunk (configurable via READ_AHEAD). */
export const DEFAULT_READ_AHEAD = 2;

/** Maximum allowed read-ahead streams (configurable via READ_AHEAD). */
export const MAX_READ_AHEAD = 128;

/** Maximum concurrent HIBP API requests. */
export const MAX_HIBP_CONCURRENCY = 1000;

/** Maximum concurrent file reads for split-directory processing. */
export const MAX_SPLIT_FILE_CONCURRENCY = 1024;

/** Maximum concurrent file reads for index-based processing. */
export const MAX_INDEX_READER_CONCURRENCY = 1024;

/**
 * Memory headroom multiplier for chunk count calculation.
 *
 * The actual chunk count is limited to `availableMem / (perChunkBytes * MEMORY_HEADROOM)`
 * to leave room for GC, OS buffers, and other processes.
 */
export const MEMORY_HEADROOM = 1.5;

/** Length of a SHA-1 hex string (40 characters). */
export const SHA1_HEX_LENGTH = 40;

/** Length of an NTLM (MD4) hex string (32 characters = 16 bytes). */
export const NTLM_HEX_LENGTH = 32;

/** Length of the NTLM hash suffix returned by the HIBP API (27 chars = 32 - 5 prefix). */
export const NTLM_API_HASH_SUFFIX_LENGTH = 27;

/**
 * Sequential read speed threshold for HDD vs SSD classification (300 MB/s).
 *
 * Drives slower than this are treated as HDDs, which affects chunk count,
 * concurrency, and read mode selection.
 */
export const SSD_SEQUENTIAL_THRESHOLD_MB = 300;

// Index layout

/** Length of the hex prefix used in `.idx` files (5 hex characters = 20 bits). */
export const INDEX_PREFIX_LENGTH = 5; // hex characters

/** Number of bits in the index prefix. */
export const IDX_PREFIX_BITS = INDEX_PREFIX_LENGTH * 4;

/** Number of distinct prefixes in the index (16^5 = 1,048,576). */
export const IDX_PREFIX_COUNT = 16 ** INDEX_PREFIX_LENGTH;

/** Size of the `.idx` file header in bytes (see `IDX_HEADER_SIZE_V2`). */
export const IDX_HEADER_SIZE = 19;

/** Flag byte indicating the file is sorted (stored in `.idx` header). */
export const IDX_SORTED_FLAG_OK = 0x01;

/** Legacy `.idx` header size in bytes (1 sorted flag + 8 mtime). */
export const IDX_HEADER_SIZE_LEGACY = 9;

/**
 * `.idx` header size in bytes for the v2 layout.
 *
 * Layout: byte 0 sorted flag, byte 1 version marker, byte 2 hash type,
 * bytes 3-10 mtime (BigInt64LE), bytes 11-18 file size (BigUInt64LE).
 */
export const IDX_HEADER_SIZE_V2 = 19;

/** Version marker stored at byte 1 of a v2 `.idx` header. */
export const IDX_VERSION_V2 = 0x02;

/** Hash-type code for a legacy/unknown `.idx` header. */
export const IDX_HASH_TYPE_UNKNOWN = 0;

/** Hash-type code for a SHA-1 indexed corpus. */
export const IDX_HASH_TYPE_SHA1 = 1;

/** Hash-type code for an NTLM indexed corpus. */
export const IDX_HASH_TYPE_NTLM = 2;

// Max valid HIBP line: SHA1_HEX(40) + ':'(1) + count(~10) + '\n'(1) = ~52 bytes
/** Maximum allowed line length in bytes (256 — generous margin over ~52 typical). */
export const MAX_LINE_BYTES = 256;

/** Average HIBP line length in bytes (used for binary search time estimation). */
export const AVG_HIBP_LINE_LENGTH = 45;
// 256 bytes is sufficient for HIBP lines (~50 bytes) with 5x safety margin

/** Bytes to read per binary search probe (256 — covers one HIBP line with margin). */
export const BINARY_SEARCH_READ_SIZE = 256;

// HIBP API / split-file SHA-1 suffix length (40-char SHA-1 hash minus the 5-char prefix)
/** Length of the SHA-1 hash suffix returned by the HIBP API / stored in split files (35 chars). */
export const HIBP_API_HASH_LENGTH = 35;

// Sortedness check

/**
 * Strata size in bytes for deterministic sortedness sampling (4 GiB).
 *
 * Region count N = clamp(ceil(fileSize / SORTEDNESS_SAMPLE_STRATA_BYTES),
 * SORTEDNESS_MIN_REGIONS, SORTEDNESS_MAX_REGIONS).
 */
export const SORTEDNESS_SAMPLE_STRATA_BYTES = 4 * 1024 * 1024 * 1024;

/** Minimum number of sampled regions for corpora at or above the threshold (20). */
export const SORTEDNESS_MIN_REGIONS = 20;

/** Maximum number of sampled regions regardless of corpus size (256). */
export const SORTEDNESS_MAX_REGIONS = 256;

/** Bytes read per sampled region window (4096 >= 16 x MAX_LINE_BYTES). */
export const SORTEDNESS_REGION_READ_BYTES = 4096;

/**
 * `.idx` header version marker written at byte 1 (v3 layout).
 *
 * V3 stamps the deterministic sortedness algorithm's results; any lower
 * version is treated as stale and re-verified.
 */
export const IDX_VERSION_V3 = 0x03;

// Estimation calibration — underestimate sequential, overestimate binary/index

/** SSD sequential read speed multiplier for estimation (conservative). */
export const SSD_SEQ_MULTIPLIER = 2.0;

/** Estimated SSD seek time per index read (0.3ms). */
export const SSD_INDEX_SEEK_MS = 0.3;

/** Estimated SSD base seek time for binary search (0.15ms). */
export const SSD_BINARY_BASE_SEEK_MS = 0.15;

/** HDD seek time multiplier for binary search (conservative). */
export const HDD_BINARY_MULTIPLIER = 3.0;

/** Estimated JavaScript overhead per binary search read (0.05ms). */
export const BINARY_JS_OVERHEAD_MS = 0.05;

/**
 * Resolve the full hex length for an effective hash type.
 *
 * @param type - The effective hash type (`sha1` or `ntlm`).
 * @returns 40 for sha1, 32 for ntlm.
 */
export function fullHashLengthFor(type: 'sha1' | 'ntlm'): number {
  return type === 'ntlm' ? NTLM_HEX_LENGTH : SHA1_HEX_LENGTH;
}

/**
 * Resolve the HIBP API / split-file suffix hex length for an effective hash type.
 *
 * @param type - The effective hash type (`sha1` or `ntlm`).
 * @returns 35 for sha1, 27 for ntlm.
 */
export function apiSuffixLengthFor(type: 'sha1' | 'ntlm'): number {
  return type === 'ntlm' ? NTLM_API_HASH_SUFFIX_LENGTH : HIBP_API_HASH_LENGTH;
}
