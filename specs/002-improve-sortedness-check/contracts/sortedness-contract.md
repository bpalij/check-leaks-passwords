# Contract: Sortedness Check Behavior

**Feature**: `specs/002-improve-sortedness-check/spec.md` | **Date**: 2026-10-15

The project is a CLI tool; its externally observable interfaces are CLI/env
behavior, log output, exit codes, and on-disk artifacts. This contract specifies
those surfaces for the improved sortedness check. See `../data-model.md` for
entity internals and `../research.md` for rationale.

## 1. Verdict semantics

`detectSortedness(filePath, fullHashLength)` returns exactly one of:

| Verdict | Produced when | Downstream behavior |
|---|---|---|
| `sorted` | Corpus >= 1 GiB and (fresh V3 `.idx` flag set, or live check passes) | Order-dependent reading (binary/index) enabled; `.idx` may be built and kept |
| `unsorted` | Corpus >= 1 GiB and live check fails, or fresh V3 `.idx` flag unset | `.idx` unlinked; sequential read only; index builds refused |
| `skipped` | Corpus < 1 GiB — check does not run, no reads performed, `.idx` not consulted | `.idx` unlinked; sequential read only; index builds refused |

Invariants:

- `skipped` is **indistinguishable from `sorted`/`unsorted` by construction**:
  it is a distinct value, never coerced (FR-014).
- `unsorted` and `skipped` apply the **identical fallback** (invalidate `.idx`,
  single-chunk sequential read) (FR-014).
- Only `sorted` enables order-dependent reading (spec Key Entities).

## 2. Log output contract

| Verdict | Message (exact) |
|---|---|
| `sorted` | `File sorted: yes` |
| `unsorted` | `File sorted: no` followed by `Warning: file not sorted` |
| `skipped` | `File < 1 GiB — sortedness check skipped; sequential read only` |

- The `skipped` message is neutral: it MUST NOT contain "unsorted" or "not
  sorted" and MUST NOT claim the corpus is ordered (FR-014).
- No log line ever includes sampled hash values or other corpus content
  (FR-015; Principle II — corpus content is password hashes).

## 3. Determinism guarantee

Identical corpus bytes and size ⇒ identical sampled offsets, identical anchors,
identical verdict, on every run and every machine (FR-002, FR-010, SC-003).
No randomness (`Math.random`) participates anywhere in the check.

## 4. Cost bound

For a corpus of size `F >= 1 GiB` with `N = clamp(ceil(F / 4 GiB), 20, 256)`:

- Additional bytes read by the check ≤ `N * 4096 + 2 * 8000` (regions + head/tail),
  i.e. 1,064,576 B (~1.02 MiB) at the cap (FR-006, SC-004).
- Peak memory is constant and independent of `F` and `N`: only fixed-size
  buffers are allocated and no allocation scales with corpus size (FR-005,
  SC-005). Verified by read-request inspection; exact RSS/heap measurement is
  intentionally excluded as environment-dependent and unreliable.
- For `F < 1 GiB`: zero bytes read by the check (FR-006).
- The check never reads the whole corpus (FR-006).

## 5. Refusal / error behavior

| Surface | Condition | Behavior |
|---|---|---|
| `READ_MODE_FORCED=binary\|index\|sequential-index` | verdict `unsorted` | Throws `READ_MODE_FORCED=<mode> requires a sorted file` (unchanged) |
| `READ_MODE_FORCED=binary\|index\|sequential-index` | verdict `skipped` | Throws (refused: sortedness not established — spec edge case); message MUST distinguish "not verified (file below 1 GiB)" from "not sorted" |
| `build-index` CLI | verdict `unsorted` | Error to stderr, exit code 1 (unchanged) |
| `build-index` CLI | verdict `skipped` | Error to stderr (cannot verify sortedness below 1 GiB), exit code 1 |
| Non-overlap invariant violated | `fileSize < N * max(4096, MAX_LINE_BYTES)` | Throws explicit `Error` naming the invariant — never continues with overlapping reads (FR-012) |
| Region window with no complete line | reachable only via corrupted input/constants | Reported `unsorted` with diagnostic — never silently passes (Principle I) |
| Empty file / below minimum accepted size | `F < 1 GiB` ⇒ `skipped` | Observable behavior unchanged: sequential read, no results (spec edge case: "rejected as before") |

## 6. `.idx` cache contract (version 3)

- Header layout (19 bytes): `[sortedFlag][version=0x03][hashType][mtime:8][fileSize:8]`
  — payload format and total file size unchanged.
- A cached verdict is trusted **iff all** hold: `.idx` mtime strictly newer than
  corpus mtime, version = `0x03`, hash type matches, file size matches,
  file not truncated. Otherwise the cache is stale → live re-verification →
  re-stamp V3 on next write (FR-008).
- **V2 and legacy headers are always stale**: a "sorted" flag written by the
  prior weaker algorithm MUST NOT be trusted, even if mtime is fresh (FR-008).
- `.idx` is deleted whenever the verdict is `unsorted` or `skipped`.

## 7. Format compatibility

- All existing single-file hash formats (SHA-1 40-hex, NTLM 32-hex, `HASH:COUNT`,
  LF and CRLF, duplicate values, mixed-case hex per existing conventions) keep
  working with unchanged ordering semantics (FR-008, Assumptions).
- Split-directory corpora are unaffected (different code path).

## 8. Acceptance mapping

| Success criterion | Verified by |
|---|---|
| SC-001 block-reordered corpora rejected | §1 + integration test (two sorted halves reversed → `unsorted`) |
| SC-002 no false rejections | FR-009 + sorted-corpus regression suite |
| SC-003 reproducibility | §3 contract + repeated-run test |
| SC-004 bounded read | §4 contract + read-budget test |
| SC-005 fixed-size buffers (no size-proportional allocation) | §4 contract + read-request test |
| SC-006 boundary behavior | §1/§5 (1 GiB threshold behavior) |
| SC-007 no overlapping regions | §5 non-overlap invariant |
