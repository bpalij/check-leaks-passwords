# Data Model: Improved Sortedness Check

**Feature**: `specs/002-improve-sortedness-check/spec.md` | **Date**: 2026-10-15

Phase 1 output. Entities are extracted from the feature spec's Requirements and
Key Entities sections; validation rules cite the originating FR/SC.

## Entities

### `SortednessVerdict`

Tri-state outcome of the sortedness check.

| Field | Type | Values |
|---|---|---|
| verdict | union literal | `'sorted' \| 'unsorted' \| 'skipped'` |

**Validation rules**

- `'skipped'` is only ever produced for corpora with `fileSize < SMALL_FILE_BYTES_THRESHOLD`
  (1 GiB) — the check does not run, no sorted/unsorted claim is made (FR-011).
- `'sorted'` is only ever produced for corpora at or above the threshold
  (live check or fresh V3 cache hit) (FR-007).
- `'sorted'` is the only value that enables order-dependent reading (binary/index
  modes) or an `.idx` build (spec Key Entities).

**State transitions**

```text
                     ┌─ fileSize < 1 GiB ────────────────► skipped ─┐
pre-check ───────────┤                                               ├─► .idx unlinked,
                     ├─ fresh .idx (V3, newer mtime) + flag set ──► sorted   sequential read only
                     │        (for skipped/unsorted)                    (except: sorted keeps .idx,
                     ├─ fresh .idx (V3) + flag unset ──────────► unsorted    index/binary enabled)
                     └─ no/stale .idx ─► live check ──► sorted / unsorted
```

- `unsorted` and `skipped` apply the **identical fallback**: invalidate `.idx`,
  sequential read only (FR-014), differing only in the log message
  (neutral for `skipped`, warning for `unsorted`).
- `unsorted` and `skipped` unlink the `.idx`; the next run re-enters pre-check
  (terminal for the current run).

### `RegionSample`

One deterministic stratum examined by the live check.

| Field | Type | Meaning |
|---|---|---|
| `index` | `number` | Stratum position `[0, N)` in file order |
| `offset` | `number` | Read-window start: `floor(index * fileSize / N)` (FR-002) |
| `anchor` | `string` | Hash of the first complete line after line-boundary alignment (FR-001 representative value) |
| `adjacentInRegion` | `boolean` | Local adjacent order holds across all complete lines in the window (FR-013) |

**Validation rules**

- `N = clamp(ceil(fileSize / SORTEDNESS_SAMPLE_STRATA_BYTES), SORTEDNESS_MIN_REGIONS, SORTEDNESS_MAX_REGIONS)`
  with `STRATA = 4 GiB`, `MIN = 20`, `MAX = 256` (FR-012).
- Non-overlap invariant, asserted at runtime before sampling (FR-012, SC-007):
  `fileSize >= N * max(SORTEDNESS_REGION_READ_BYTES, MAX_LINE_BYTES)`.
  Violation throws an explicit `Error` — never silently proceeds.
- A region window containing no complete line is an explicit failure condition,
  reported as `unsorted` with a diagnostic log — never silently passed
  (unreachable at the 1 GiB floor with a 4096-byte window; defensive).
- Offsets are a pure function of `fileSize` → identical corpora yield identical
  samples on every run (FR-002, FR-010, SC-003).

**Derivation rules (verdict from samples)**

- Any `adjacentInRegion === false` → `unsorted` (FR-013).
- Any `anchor[i] > anchor[j]` for `i < j` → `unsorted` (FR-003).
- Head/tail window adjacency failures → `unsorted` (FR-004, existing behavior).
- All pass → `sorted` (FR-009: never rejects a genuinely sorted corpus).

### `.idx` header (version 3)

Sidecar index header — carries the cached sortedness verdict. Layout is
unchanged in size (19 bytes); only the version marker changes.

| Offset | Size | Field | Validation |
|---|---|---|---|
| 0 | 1 | sorted flag (`0x01` = sorted, `0x00` = not) | trusted **only** when version = 3 (FR-008) |
| 1 | 1 | version = `IDX_VERSION_V3` (`0x03`) | must equal 3; V2/legacy → stale |
| 2 | 1 | hash type (0 unknown / 1 SHA-1 / 2 NTLM) | must match corpus hash type |
| 3 | 8 | corpus mtime (BigInt64LE) | `.idx` mtime must be strictly newer than corpus mtime |
| 11 | 8 | corpus file size (BigUInt64LE) | must equal actual corpus size |

**Validation rules**

- **Staleness** (any fails → cache miss → live re-verification, then re-stamp
  with V3 on next `.idx` write): mtime not strictly newer ∪ version ≠ 3 ∪
  hash-type mismatch ∪ size mismatch ∪ truncated file (FR-008).
- A stale header is **never** trusted for its sorted flag — including a stale
  V2 header whose flag is set (the exact scenario FR-008 calls out).
- Full file size unchanged: `19 + 1,048,577 * 8 = 8,388,651` bytes; loaders
  continue to use `IDX_HEADER_SIZE` (19) — no payload-format change.

### Sampling configuration constants

Exported from `src/constants.ts` with JSDoc (Principle V):

| Constant | Value | Origin |
|---|---|---|
| `SORTEDNESS_SAMPLE_STRATA_BYTES` | 4 GiB | Spec clarification: N = ceil(F / 4 GiB) |
| `SORTEDNESS_MIN_REGIONS` | 20 | Spec clarification: floor of clamp |
| `SORTEDNESS_MAX_REGIONS` | 256 | Spec clarification: cap of clamp; SC-004/SC-007 bound |
| `SORTEDNESS_REGION_READ_BYTES` | 4096 | Design decision D3: >= 16 x `MAX_LINE_BYTES` per window |
| `IDX_VERSION_V3` | `0x03` | FR-008 algorithm/index version bump |
| `SMALL_FILE_BYTES_THRESHOLD` | 1 GiB | Existing constant, reused (clarification) |
| `SORTEDNESS_CHECK_PAIRS` | *(removed)* | Random probes eliminated (FR-002) |

## Relationships

```text
Hashes corpus (1) ──produces──► SortednessVerdict (1)
Hashes corpus (1) ──sampled into──► RegionSample (N, deterministic)
RegionSample (N) ──ordered-by-file-position──► anchor comparison ──► SortednessVerdict
Hashes corpus (1) ──has sidecar──► .idx header (0..1) ──caches──► SortednessVerdict (flag bit)
```
