# Data Model: NTLM Hash Support

## Core Entities

### HashType
Represents the hash algorithm used for password lookups.

- **Values**: `'sha1'` | `'ntlm'` | `'auto'`
- **Default**: `'auto'` (for local corpora; API mode with auto resolves to sha1)
- **Behavior**:
  - `sha1`: Compute SHA-1 of password (hex uppercase), expect SHA-1 corpus format
  - `ntlm`: Compute MD4 of UTF-16LE encoded password (hex uppercase), expect NTLM corpus format
  - `auto`: Detect from corpus content; if detection ambiguous/unreadable and no explicit override, fail

`HashType` is a **value union**, not an object; the runtime shape is `ActiveHashInfo`
(below). The effective type is always `'sha1' | 'ntlm'` (never `'auto'`); the requested
value (which may be `'auto'`) and how the effective value was chosen live on
`ActiveHashInfo`.

### HashTypeMismatchMode
Controls behavior when requested hash type conflicts with detected corpus type.

- **Values**: `'error'` | `'warn'`
- **Default**: `'error'`
- **Behavior**:
  - `error`: Abort before scanning with clear message naming requested and detected types
  - `warn`: Emit prominent warning and self-correct to detected type; results remain correct

**Rules**: Both modes abort if detection is ambiguous/unreadable. Mixed/ambiguous formats treated as data integrity error.

### ActiveHashInfo (canonical runtime shape)
The single runtime hash-type shape used throughout a run (replaces the earlier,
overlapping `HashTypeConfig`/`ActiveHashInfo` split).

- `requested`: The originally requested hash type (`'sha1' | 'ntlm' | 'auto'`).
- `type`: The effective hash type (`'sha1' | 'ntlm'`).
- `fullHashLength`: `40` (sha1) or `32` (ntlm).
- `apiSuffixLength`: `35` (sha1) or `27` (ntlm).
- `source`: How the effective type was chosen — `'explicit' | 'detected' | 'corrected' | 'api-default'`
  (use one union everywhere; `'corrected'` denotes `warn`-mode self-correction; `'api-default'`
  denotes `auto` in API mode, which resolves to sha1 with a notice since there is no corpus to sample).
- `mismatchMode`: The active `HashTypeMismatchMode`.

`ConfigInterface` carries the requested `hashType: HashType` and `hashTypeMismatch:
HashTypeMismatchMode`; the resolution step produces `ActiveHashInfo`.

### IndexMetadata
Metadata stored in `.idx` index file header.

**Current header** (legacy, 9 bytes total):
- Byte 0: `IDX_SORTED_FLAG_OK` (0x01) if sorted, else 0x00
- Bytes 1-8: mtime (BigInt64LE)

**New header (v2)**, `IDX_HEADER_SIZE = 19` bytes:
- Byte 0: sorted flag — `IDX_SORTED_FLAG_OK` (0x01) if sorted, else 0x00. **Semantics
  unchanged** from the legacy layout and stays at byte 0, so the fast-path sortedness
  read in `detectSortedness.ts` (`header[0] & IDX_SORTED_FLAG_OK`) keeps working.
- Byte 1: version marker — fixed constant `IDX_VERSION_V2 = 0x02`.
- Byte 2: hash type (0 = unknown/legacy, 1 = sha1, 2 = ntlm).
- Bytes 3-10: mtime (BigInt64LE, 8 bytes).
- Bytes 11-18: file size (BigUInt64LE, 8 bytes).

**Legacy / version detection (deterministic)**:
- A header is v2 **iff** the whole file size is `IDX_HEADER_SIZE + (IDX_PREFIX_COUNT + 1) * 8`
  **and** byte 1 == `IDX_VERSION_V2`. Anything else (legacy 9-byte header, wrong size,
  absent/other marker) is treated as legacy/stale.

**Validation on load**:
- If legacy/stale (see above), invalidate and rebuild.
- Compare stored hash type against the current effective hash type — must match.
- Compare stored file size against the current file size — must match.
- Compare mtime against the file mtime — index mtime must be >= file mtime (freshness).

If any mismatch or legacy format, invalidate and rebuild. The `.idx` header MUST never be
applied to a different hash type or a different-size file.

### ActiveHashInfo
Runtime info about active hash type for this run.

- `type`: 'sha1' | 'ntlm'
- `fullHashLength`: 40 (sha1) or 32 (ntlm)
- `apiSuffixLength`: 35 (sha1) or 27 (ntlm)  
- `hexEncoding`: 'ascii' (hex chars are ASCII)
- `source`: 'explicit' | 'detected' | 'corrected' | 'api-default'

### CorpusFormat
Detected corpus format characteristics.

- `type`: 'sha1' | 'ntlm' | 'unknown' | 'ambiguous'
- `isSingleFile`: boolean
- `isSplitDir`: boolean
- For single file: `hashLength` (40 or 32) from sampled line
- For split dir: `suffixLength` (35 or 27) from sampled suffix file
