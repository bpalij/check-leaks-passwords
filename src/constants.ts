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

/** Files smaller than 1 GB skip the drive speed test and use a single chunk. */
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

/** Size of the `.idx` file header in bytes (1 flag + 8 mtime). */
export const IDX_HEADER_SIZE = 9;

/** Flag byte indicating the file is sorted (stored in `.idx` header). */
export const IDX_SORTED_FLAG_OK = 0x01;

// Max valid HIBP line: SHA1_HEX(40) + ':'(1) + count(~10) + '\n'(1) = ~52 bytes
/** Maximum allowed line length in bytes (256 — generous margin over ~52 typical). */
export const MAX_LINE_BYTES = 256;

/** Average HIBP line length in bytes (used for binary search time estimation). */
export const AVG_HIBP_LINE_LENGTH = 45;
// 256 bytes is sufficient for HIBP lines (~50 bytes) with 5x safety margin

/** Bytes to read per binary search probe (256 — covers one HIBP line with margin). */
export const BINARY_SEARCH_READ_SIZE = 256;

// HIBP API response hash length (SHA-1 hex = 40 chars, but API returns 35-char prefix+suffix)
/** Length of the hash prefix returned by the HIBP API (35 chars: 5 prefix + 30 suffix). */
export const HIBP_API_HASH_LENGTH = 35;

// Sortedness check
/** Number of random position pairs to check when detecting file sortedness. */
export const SORTEDNESS_CHECK_PAIRS = 20;

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
