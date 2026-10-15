# Research: NTLM Hash Support

## Overview

Add NTLM hash support to the password leak checker. NTLM uses MD4 hash of UTF-16LE encoded password (uppercase hex). HIBP NTLM corpus has different hash lengths than SHA-1.

## Key Format Differences

- **SHA-1**: 40 hex chars. Full hash in single-file lines before separator. Split-prefix suffix files contain 35-char suffix (40-5). API returns 35-char suffix. 
- **NTLM**: 32 hex chars (MD4 produces 16 bytes). Single-file: 32-char hash. Split-prefix suffix: 27 chars (32-5). API returns 27-char suffix.
- HIBP API prefix length remains 5 chars for both.

## NTLM Hash Computation

**Decision**: Implement a self-contained MD4 (RFC 1320) in `src/crypto/md4.ts` and compute
NTLM as `md4(buffer).toString('hex').toUpperCase()` where `buffer = Buffer.from(password, 'utf16le')`.

**Rationale / verified facts (Node v26.5.0, the `.nvmrc` baseline)**:
- `crypto.getHashes()` does **not** include `md4`.
- `crypto.createHash('md4')` throws `error:0308010C:digital envelope routines::unsupported`
  because Node 26 ships OpenSSL 3 where MD4 lives in the legacy provider.
- Enabling MD4 would require `--openssl-legacy-provider` (or equivalent), which the spec
  forbids: "Running NTLM hashing must not require weakening the process's cryptographic
  environment or adding untrusted dependencies" (spec.md Assumptions; Constitution II).

**Alternatives considered**:
- *Legacy provider flag* — rejected: weakens the process cryptographic environment (spec violation).
- *Third-party MD4 package* — rejected: Constitution dependency policy discourages unnecessary
  third-party dependencies in security-critical crypto code.
- *Self-contained MD4* — chosen. MD4 is small and deterministic; correctness is pinned to the
  reference vectors below and in quickstart.md.

**Correctness pins** (uppercase hex, must hold in unit tests):
- `password` → `8846F7EAEE8FB117AD06BDD830B7586C`
- `00000000` → `9BDC61DB5A3FCED6D82D49279F1F0430`
- `123456` → `32ED87BDB5FDC5E9CBA88547376818D4`
- `letmein` → `BECEDB42EC3C5C7F965255338BE4453C`
- `password123` → `A9FDFA038C4B75EBC76DC855DD74F0DA`

### Sensitive buffer lifetime

**Decision**: Compute every password hash from an explicitly owned buffer and zero it immediately after
use, and also zero the internal password-derived working buffers inside MD4:

- `hashPassword` routes both branches through `Buffer.from(password, ...)` (`utf8` for sha1 —
  identical bytes to `crypto.hash('sha1', string)`; `utf16le` for ntlm) and clears it with the
  existing `zeroBuffer()` helper (`src/memory/secureCleanup.ts`) in a `finally`.
- `md4` clears its `padded` buffer (which contains the full password plus padding) and its `x`
  message-word `Uint32Array` in a `finally`. The returned digest is a fresh `Buffer.alloc(16)` and
  the caller's input buffer remains unmutated.

**Rationale**: Constitution II and AGENTS.md require clearing sensitive buffers when practical and
minimizing secret lifetime. The decrypt paths (`src/crypto/decryptBitwardenExport.ts`) already zero
`passwordBuf`/`masterKey` via `zeroBuffer()`, so this reuses an established, audited pattern rather
than introducing a new mechanism. Hashing is the only place a plaintext password is materialized as
a raw buffer outside decryption.

**Alternatives considered**:
- *`trackBuffer` (exit-time zeroing)* — rejected: these buffers are short-lived and zeroed
  synchronously right after hashing; registering them only adds tracking overhead with no benefit.
- *Zero only the `hashPassword` buffer* — rejected: `md4` retains independent copies (`padded`, `x`)
  that would keep the password recoverable in memory after hashing.
- *Leave the SHA-1 string path as-is* — rejected for consistency: taking ownership of the UTF-8
  buffer makes both branches uniformly zeroable.

**Correctness pins**: all NTLM vectors above and the SHA-1 pin must be unchanged by this change
(the encoding is byte-identical; only the buffer's lifetime changes).

## Codebase Touchpoints

### Types (`src/types.ts`)
Need `HashType` enum/type: 'sha1' | 'ntlm' | 'auto' (or similar). Also `HashTypeMismatchMode` ('error' | 'warn'). Add to ConfigInterface. Add hashType to relevant result types if needed for outputs.

### Constants (`src/constants.ts`)
Add:
- `NTLM_HEX_LENGTH = 32`
- `NTLM_API_HASH_SUFFIX_LENGTH = 27` (or derive from 32-5)
- Also consider generic naming or keep as-is; code reads them in context.

### Config & Env
- `envDefaults.ts`: add `HASH_TYPE: 'auto'`, `HASH_TYPE_MISMATCH: 'error'`
- `envLoader.ts`: parse enums for HASH_TYPE and HASH_TYPE_MISMATCH
- `validateConfig.ts`: validate allowed values
- `index.ts`: update CLI help
- `.env.example`: document new vars
- `README.md`: document feature (per spec FR-013)

### Hashing
- `checkPasswordsLeaks.ts` (line ~322): needs to compute hash based on active hash type. Need to abstract hash function.
- Create `src/hashing/hashPassword.ts` (or add to crypto module) to compute hash by type.

### Auto-detection & Mismatch
Need to detect hash type from corpus:
- Single file: read first non-empty line, extract hash part before colon → length 40 (sha1), 32 (ntlm). Handle CRLF/LF.
- Split dir: sample a prefix file with content, look at suffix part before colon → length 35 (sha1, 40-5), 27 (ntlm, 32-5). Must not use filenames.
- API mode: auto resolves to sha1 with notice.

Mismatch handling per FR-007. When explicit hash type conflicts with detected, in error mode abort with clear message; in warn mode emit warning and self-correct to detected type. Detection ambiguous/unreadable → abort in both modes.

### Index files
Index header is currently 9 bytes (1 byte flag + 8 bytes mtime) in modeResolver/loadIndex/write path. Spec requires storing hash type (and file size). Also legacy indexes without marker must be treated as stale.
Need to extend header. Possible format: 1 byte flags/marker, 1 byte hash type (or store as enum), 8 bytes mtime, 8 bytes fileSize (BigInt64/BigUInt64)? Or just store what’s needed. Also need versioning. Current check is just mtime freshness; spec says validate hash type and size match current run. So store hash type and size in header, validate on load.
Legacy indexes (missing the new fields/marker) are stale → need to detect. Can add a version byte.

### Processing paths
- `processSingleFile.ts`, `readModes/*`, `processChunk*`, `parseBuffer` all use SHA1-specific lengths. Need to make them parameterized by hash type (or active hash lengths).
- `parseBuffer` already takes `hashLength` as param - good. Also for API mode, suffix/hash length differs.
- `HIBP_API_HASH_LENGTH` is 35 for SHA1; becomes 27 for NTLM. Need to compute based on hash type.
- Grouping by prefix (5 chars) same for both.

### Outputs
- FR-010: each result must carry active hash type (CSV column and JSON property). Stored password hash field must reflect hash type actually used (including self-corrected). Console summary must state hash type.
- Update CSV/JSON writers to include hash type. Also update formatting in checkPasswordsLeaks summary.

## Implementation Strategy

1. **Add types & constants first** - define HashType enum, add config types.
2. **Hash computation abstraction** - create function to compute hash by type (handle MD4 properly).
3. **Config/env parsing** - add HASH_TYPE, HASH_TYPE_MISMATCH with validation.
4. **Detection utilities** - functions to detect hash type from corpus (single file, split dir).
5. **Extend index header** - redesign header to include hash type and size, with versioning for legacy detection.
6. **Thread hash type through processing** - propagate hash type/config so all paths use correct lengths (full hash length, API suffix length).
7. **Update all readers/processors** - parameterize by hash type.
8. **Update outputs & summaries** - include hash type in results and console output.
9. **Update docs/CLI/help** - README, .env.example, index.ts help.
10. **Add tests** - NTLM fixtures and test cases.
