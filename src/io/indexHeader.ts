import {
  IDX_HEADER_SIZE_V2,
  IDX_VERSION_V3,
  IDX_HASH_TYPE_UNKNOWN,
  IDX_HASH_TYPE_SHA1,
  IDX_HASH_TYPE_NTLM,
  IDX_SORTED_FLAG_OK,
  NTLM_HEX_LENGTH,
  SHA1_HEX_LENGTH,
} from '../constants.js';

/**
 * Decoded `.idx` (v3) header fields.
 *
 * @security The header contains no secrets — only corpus metadata.
 */
export interface IndexHeader {
  /** Whether the indexed corpus was sorted when the index was built. */
  sorted: boolean;
  /** Header layout version marker (`IDX_VERSION_V3` for v3). */
  version: number;
  /** Hash-type code (`IDX_HASH_TYPE_SHA1` or `IDX_HASH_TYPE_NTLM`). */
  hashType: number;
  /** Corpus modification time, in seconds (opaque, not used for validation). */
  mtime: bigint;
  /** Corpus file size in bytes, used to detect stale indexes. */
  fileSize: bigint;
}

/**
 * Map a full hash length to its `.idx` hash-type code.
 *
 * @param fullHashLength - Full hex hash length (40 for SHA-1, 32 for NTLM).
 * @returns The matching hash-type code, or `IDX_HASH_TYPE_UNKNOWN`.
 */
export function hashTypeCodeFor(fullHashLength: number): number {
  if (fullHashLength === SHA1_HEX_LENGTH) return IDX_HASH_TYPE_SHA1;
  if (fullHashLength === NTLM_HEX_LENGTH) return IDX_HASH_TYPE_NTLM;
  return IDX_HASH_TYPE_UNKNOWN;
}

/**
 * Encode a v3 `.idx` header buffer.
 *
 * Layout: byte 0 sorted flag, byte 1 version marker, byte 2 hash-type code,
 * bytes 3–10 mtime (BigInt64LE), bytes 11–18 file size (BigUInt64LE).
 *
 * @param params - Header field values.
 * @param params.sorted - Whether the corpus is sorted.
 * @param params.hashType - Hash-type code (see {@link hashTypeCodeFor}).
 * @param params.mtime - Corpus modification time in seconds.
 * @param params.fileSize - Corpus file size in bytes.
 * @returns A freshly allocated `IDX_HEADER_SIZE_V2`-byte buffer.
 * @security Encodes only corpus metadata; never secret material.
 */
export function encodeIndexHeader(params: {
  sorted: boolean;
  hashType: number;
  mtime: bigint;
  fileSize: bigint;
}): Buffer {
  const buf = Buffer.alloc(IDX_HEADER_SIZE_V2);
  buf[0] = params.sorted ? IDX_SORTED_FLAG_OK : 0;
  buf[1] = IDX_VERSION_V3;
  buf[2] = params.hashType & 0xff; // eslint-disable-line no-bitwise -- mask to one byte
  buf.writeBigInt64LE(params.mtime, 3);
  buf.writeBigUInt64LE(params.fileSize, 11);
  return buf;
}

/**
 * Decode a v3 `.idx` header buffer.
 *
 * @param buf - Buffer whose first `IDX_HEADER_SIZE_V2` bytes are the header.
 * @returns The decoded header fields.
 * @throws {Error} If the buffer is shorter than `IDX_HEADER_SIZE_V2`.
 */
export function decodeIndexHeader(buf: Buffer): IndexHeader {
  if (buf.length < IDX_HEADER_SIZE_V2) {
    throw new Error(
      `Index header too short: expected ${IDX_HEADER_SIZE_V2} bytes, got ${buf.length}`,
    );
  }
  // eslint-disable-next-line no-bitwise -- flag byte unpacking
  const sorted = (buf[0] & IDX_SORTED_FLAG_OK) !== 0;
  return {
    sorted,
    version: buf[1],
    hashType: buf[2],
    mtime: buf.readBigInt64LE(3),
    fileSize: buf.readBigUInt64LE(11),
  };
}

/**
 * Check a decoded `.idx` header against the expected corpus metadata.
 *
 * A mismatch (wrong version, hash type or file size) means the index is stale
 * or was built for a different corpus/hash type and must not be trusted.
 *
 * @param header - Decoded header.
 * @param expected - Expected metadata for the corpus being scanned.
 * @param expected.hashType - Expected hash-type code.
 * @param expected.fileSize - Expected corpus file size in bytes.
 * @returns A result object; `ok: false` carries a human-readable reason.
 */
export function checkIndexHeader(
  header: IndexHeader,
  expected: { hashType: number; fileSize: number },
): { ok: true } | { ok: false; reason: string } {
  if (header.version !== IDX_VERSION_V3) {
    return { ok: false, reason: `legacy or unknown index version ${header.version}` };
  }
  if (header.hashType !== expected.hashType) {
    return {
      ok: false,
      reason: `index hash type ${header.hashType} does not match expected ${expected.hashType}`,
    };
  }
  if (header.fileSize !== BigInt(expected.fileSize)) {
    return {
      ok: false,
      reason: `index file size ${header.fileSize} does not match corpus size ${expected.fileSize}`,
    };
  }
  return { ok: true };
}
