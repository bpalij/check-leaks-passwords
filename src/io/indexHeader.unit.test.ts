import { describe, it, expect } from 'vitest';

import {
  IDX_HEADER_SIZE_V2,
  IDX_VERSION_V2,
  IDX_VERSION_V3,
  IDX_HASH_TYPE_SHA1,
  IDX_HASH_TYPE_NTLM,
  IDX_HASH_TYPE_UNKNOWN,
  SHA1_HEX_LENGTH,
  NTLM_HEX_LENGTH,
} from '../constants.js';
import {
  checkIndexHeader,
  decodeIndexHeader,
  encodeIndexHeader,
  hashTypeCodeFor,
} from './indexHeader.js';

describe('indexHeader', () => {
  it('encodes a v3 header with the sorted flag at byte 0', () => {
    const buf = encodeIndexHeader({
      sorted: true,
      hashType: IDX_HASH_TYPE_SHA1,
      mtime: 123n,
      fileSize: 456n,
    });

    expect(buf.length).toBe(IDX_HEADER_SIZE_V2);
    expect(buf[0]).toBe(0x01);
    expect(buf[1]).toBe(IDX_VERSION_V3);
    expect(buf[2]).toBe(IDX_HASH_TYPE_SHA1);
  });

  it('round-trips all header fields', () => {
    const encoded = encodeIndexHeader({
      sorted: false,
      hashType: IDX_HASH_TYPE_NTLM,
      mtime: 1_700_000_000n,
      fileSize: 89_000_000_000n,
    });
    const decoded = decodeIndexHeader(encoded);

    expect(decoded).toEqual({
      sorted: false,
      version: IDX_VERSION_V3,
      hashType: IDX_HASH_TYPE_NTLM,
      mtime: 1_700_000_000n,
      fileSize: 89_000_000_000n,
    });
  });

  it('throws when the buffer is shorter than the v2 header', () => {
    expect(() => decodeIndexHeader(Buffer.alloc(IDX_HEADER_SIZE_V2 - 1))).toThrow(/too short/);
  });

  it('maps full hash lengths to hash-type codes', () => {
    expect(hashTypeCodeFor(SHA1_HEX_LENGTH)).toBe(IDX_HASH_TYPE_SHA1);
    expect(hashTypeCodeFor(NTLM_HEX_LENGTH)).toBe(IDX_HASH_TYPE_NTLM);
    expect(hashTypeCodeFor(0)).toBe(IDX_HASH_TYPE_UNKNOWN);
  });

  it('accepts a matching header', () => {
    const header = decodeIndexHeader(encodeIndexHeader({
      sorted: true,
      hashType: IDX_HASH_TYPE_NTLM,
      mtime: 0n,
      fileSize: 100n,
    }));
    expect(checkIndexHeader(header, { hashType: IDX_HASH_TYPE_NTLM, fileSize: 100 }))
      .toEqual({ ok: true });
  });

  it('rejects a V2-stamped header even with the sorted flag set (FR-008)', () => {
    const buf = encodeIndexHeader({
      sorted: true,
      hashType: IDX_HASH_TYPE_SHA1,
      mtime: 0n,
      fileSize: 1n,
    });
    buf[1] = IDX_VERSION_V2;

    const result = checkIndexHeader(decodeIndexHeader(buf), {
      hashType: IDX_HASH_TYPE_SHA1,
      fileSize: 1,
    });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('version') });
  });

  it('rejects a legacy header version', () => {
    const buf = encodeIndexHeader({
      sorted: true,
      hashType: IDX_HASH_TYPE_SHA1,
      mtime: 0n,
      fileSize: 1n,
    });
    buf[1] = 0;

    const result = checkIndexHeader(decodeIndexHeader(buf), {
      hashType: IDX_HASH_TYPE_SHA1,
      fileSize: 1,
    });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('version') });
  });

  it('rejects a hash-type mismatch', () => {
    const header = decodeIndexHeader(encodeIndexHeader({
      sorted: true,
      hashType: IDX_HASH_TYPE_NTLM,
      mtime: 0n,
      fileSize: 10n,
    }));

    const result = checkIndexHeader(header, { hashType: IDX_HASH_TYPE_SHA1, fileSize: 10 });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('hash type') });
  });

  it('rejects a file-size mismatch (same-path corpus swap)', () => {
    const header = decodeIndexHeader(encodeIndexHeader({
      sorted: true,
      hashType: IDX_HASH_TYPE_SHA1,
      mtime: 0n,
      fileSize: 10n,
    }));

    const result = checkIndexHeader(header, { hashType: IDX_HASH_TYPE_SHA1, fileSize: 11 });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('file size') });
  });
});
