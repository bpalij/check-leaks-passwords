# Research: Improved Sortedness Check

**Feature**: `specs/002-improve-sortedness-check/spec.md` | **Date**: 2026-10-15

Phase 0 research. All unknowns extracted from the Technical Context were resolved
by the spec's Session 2026-10-15 clarifications; this document records the design
decisions derived from them, the rationale, and the alternatives considered.

## Current-state findings (baseline)

- The check lives in `src/hashing/detectSortedness.ts` and runs three phases:
  a head window (8000 B), a tail window (8000 B), then **20 probes at
  `Math.random()` offsets** comparing a single adjacent pair each. There is no
  cross-region (block-level) ordering verification, and runs on the same corpus
  can disagree — the defects the spec targets.
- The cached verdict is **not a separate file**: it is the sorted flag at byte 0
  of the `.idx` header, trusted when `.idx` mtime is strictly newer than the
  corpus. The cache-read path reads only byte 0 and never checks the version
  marker at byte 1, so verdicts stamped by the weaker algorithm are trusted
  verbatim (the FR-008 gap).
- `SMALL_FILE_BYTES_THRESHOLD` = 1 GiB (`src/constants.ts`) gates single-chunk
  sequential processing in `determineOptimalChunkCount.ts`.
- Callers of `detectSortedness`: `io/modeResolver.ts` (`detectSortednessAndCleanup`),
  `scripts/buildIndex.ts`, and tests. Downstream behavior today is a boolean
  `sorted` that enables binary/index read modes and `.idx` builds.

## Decisions

### D1 — Tri-state verdict type

**Decision**: `type SortednessVerdict = 'sorted' | 'unsorted' | 'skipped'`, declared
in `src/types.ts`. `detectSortedness` and `detectSortednessAndCleanup` return it.

**Rationale**: FR-011/FR-014 require a distinct "skipped" outcome that is
distinguishable from both other states while sharing the "unsorted" fallback.
A boolean cannot express this; a union is the simplest explicit representation.

**Alternatives considered**: `boolean | null` (obscure semantics), enum-like object
constants (heavier without benefit), keeping boolean and adding a side channel
(error codes/logs) — rejected because logs are not a contract.

### D2 — Skip gate runs first, before any I/O or cache consult

**Decision**: `fileSize < SMALL_FILE_BYTES_THRESHOLD` (reused 1 GiB threshold) →
return `skipped` immediately: no reads, no `.idx` consultation. Downstream:
unlink `.idx`, sequential read only, **no index build** (`runSequential(false, false)`).
Neutral log: `File < 1 GiB — sortedness check skipped; sequential read only`.

**Rationale**: Clarifications fixed "small = existing 1 GiB threshold" and
"skip entirely, go straight to sequential read". The old minimum-size gate
(`fileSize < hashLength + 5 → false`) is subsumed: every such file is below
1 GiB, so it now reports `skipped`; observable behavior for empty/tiny files
(sequential read, no results, no crash) is unchanged. Index builds for
sub-threshold corpora are dropped because a `.idx` whose sorted flag can never
be trusted (the check always skips below the threshold) is dead weight — today's
builds for small files are never consulted by the scan flow.

**Alternatives considered**: consulting the cached verdict for small files first
— rejected, FR-011 says the check MUST NOT report sorted/unsorted below the
threshold; raising the minimum accepted size — rejected by the spec's Assumptions.

### D3 — Sampling algorithm: deterministic evenly spaced strata

**Decision**:
- Region count: `N = clamp(ceil(F / 4 GiB), 20, 256)`.
- Region `i` read window starts at `offset_i = floor(i * F / N)` for `i ∈ [0, N)`;
  window size `SORTEDNESS_REGION_READ_BYTES = 4096`.
- Per region: skip the partial first line (scan to next newline), verify local
  adjacency across all complete lines inside the window (FR-013), and take the
  first complete line's hash as the region **anchor** (FR-001 "representative
  value").
- Verdict `unsorted` if any anchor exceeds a later anchor (FR-003) or any
  intra-region adjacency fails (FR-004/FR-013).
- Existing 8000-byte head and tail windows are retained (FR-006 explicitly
  mentions "bounded head/tail windows").
- Hash comparison semantics unchanged: ASCII string `>` on hash slices, same as
  the existing `checkBufferSorted` — the spec's Assumptions defer to existing
  conventions for case handling and duplicates.

**Rationale**: Offsets are a pure function of `fileSize` → deterministic across
runs (FR-002, SC-003). A 4096-byte window covers at least 16 maximum-length
records (`MAX_LINE_BYTES = 256`), giving every stratum both a usable anchor and
meaningful intra-region adjacency coverage, while 256 x 4096 B caps total sampled
reads at ~1.06 MB — negligible against 89 GiB (SC-004). The 20 floor keeps overhead
trivial at the 1 GiB boundary; the 256 cap bounds worst case (both fixed by the
spec's clarifications).

**Alternatives considered**: fixed N regardless of size — rejected by the
clarification (size-scaled, bounded); midpoint offsets `floor((i + 0.5) * F / N)` —
functionally equivalent for evenly spaced strata, rejected for the simpler
`floor(i * F / N)` form which also guarantees the first region starts at offset 0;
larger windows (e.g. 64 KB) — rejected, multiplies read cost without detection
benefit; anchoring on the region's *last* line — rejected, first line after
alignment is simpler and order-equivalent within a region.

### D4 — Runtime validation of the non-overlap invariant

**Decision**: before sampling, assert
`fileSize >= N * max(SORTEDNESS_REGION_READ_BYTES, MAX_LINE_BYTES)`;
on violation throw an explicit `Error` naming the invariant (FR-012 requires
enforced-or-validated, not assumed).

**Rationale**: With the 1 GiB floor the requirement is at most
256 x 4096 B = 1 MiB, so the invariant cannot fail today; the check is a
defensive invariant that catches future constant drift or threshold changes.
Constitution Principle I prefers an explicit error over silently continuing with
overlapping (possibly misordered) region reads.

**Alternatives considered**: silently clamping N — rejected (masks
misconfiguration with a weaker check); asserting only in tests — rejected
(FR-012 says "at runtime"); treating violation as `unsorted` — rejected (that
would be an incorrect verdict, not a detected invalid state).

### D5 — Cache staleness via `.idx` version bump to V3

**Decision**: add `IDX_VERSION_V3 = 0x03`. `encodeIndexHeader` stamps V3;
`checkIndexHeader` requires V3. The sortedness cache-read path in
`detectSortedness.ts` is upgraded from "read byte 0" to `decodeIndexHeader` +
version check (the 19-byte header is already read — zero additional I/O).
V2/legacy headers → treated stale → live re-verification → re-stamped V3 by the
existing `.idx` writer in `sequential.ts` (FR-008).

**Rationale**: The clarification says exactly "bump an algorithm/index version so
caches from the old algorithm are treated as stale and re-verified, then
re-stamped". Bumping the *whole* index version (rather than a dedicated
sortedness-algorithm byte) is correct because both header fields are tainted
together: a false "sorted" verdict can allow an `.idx` table to be built over an
actually-unsorted corpus, and for such a corpus a prefix may occur in disjoint
blocks, so the table's `[prefix, prefix+1)` range would miss later occurrences —
the table itself is untrustworthy, not just the flag. `checkIndexHeader` already
rejects version mismatches for the loader, so one constant fixes both consumers.

**Alternatives considered**: dedicated algorithm byte in the header — rejected,
the 19-byte header has no spare byte and growing it changes the file size check
for no extra safety; mtime-based invalidation alone — rejected, old `.idx` files
remain newer than their corpus; content hashing of the corpus — rejected, reads
the whole file (violates FR-006).

### D6 — Caller mapping for the tri-state verdict

**Decision**:

| Caller | `sorted` | `unsorted` | `skipped` |
|---|---|---|---|
| `modeResolver.detectSortednessAndCleanup` | log `File sorted: yes`, keep `.idx` | log `Warning: file not sorted`, unlink `.idx` | neutral skip log, unlink `.idx` |
| `processSingleFile` small-file / chunk-override path | `runSequential(buildIdx, true)` | `runSequential(false, false)` | `runSequential(false, false)` |
| `processSingleFile` forced `READ_MODE_FORCED` binary/index/sequential-index | allowed | throw (unchanged) | **throw**: sortedness not established |
| `processSingleFile` auto/binary/index paths | enabled | sequential-only short-circuit (unchanged) | unreachable — small files return early |
| `scripts/buildIndex.ts` | build | exit 1 (unchanged) | **exit 1**: cannot verify sortedness |

**Rationale**: Only `sorted` enables order-dependent reading (spec Key Entities).
The forced-mode refusal for `skipped` is a documented spec edge case ("refused
because sortedness is not established"). `buildIndex` must refuse on `skipped`
for the same reason: it exists to produce an index for order-dependent reading.

**Alternatives considered**: treating `skipped` as `sorted` for small files since
"small files were checked before" — rejected, the check no longer runs below the
threshold (FR-011) and the old random probes could not establish global order
anyway; allowing forced mode to fall back to sequential instead of throwing —
rejected, a forced-mode user asking for binary expects an error if impossible,
not a silent mode change (matches existing `!sorted` behavior).

### D7 — Module layout

**Decision**: keep `detectSortedness.ts` as the entry point (stat, threshold
gate, `.idx` cache consult, head/tail windows, orchestration); new sibling
`src/hashing/sortednessSampling.ts` exports the pure, I/O-free core:
`computeRegionCount(fileSize)`, `computeSampleOffsets(fileSize, count)`, plus the
region-read/anchor-extraction function that takes an open file handle.
Constants go in `src/constants.ts` under the existing `// Sortedness check`
section; `SORTEDNESS_CHECK_PAIRS` is removed (no longer referenced).

**Rationale**: Separating pure math from I/O makes the deterministic core
trivially unit-testable without `fs` mocking (testability priority) and keeps
each module focused (GRASP). The entry file's path is load-bearing — seven call
sites import from it — so it does not move.

**Alternatives considered**: everything in `detectSortedness.ts` — rejected, mixes
pure logic with cache/I/O orchestration and forces mock-heavy tests for the
offset math; a `src/hashing/sortedness/` directory — rejected as
overengineering for two modules.

### D8 — Test strategy for the >= 1 GiB path

**Decision**:
- Unit tests exercise the pure sampling functions directly with small synthetic
  sizes (no I/O) and the entry point with mocked `fd` (existing test style).
- A new integration test generates ~1.05 GiB corpora in `os.tmpdir()` via
  chunked writes (~64 x 16 MB), runs the real check, and removes them in
  `afterEach`: sorted corpus → `sorted`; two internally-sorted halves written in
  reverse → `unsorted`; repeated runs → identical verdicts.

**Rationale**: Covers SC-001/SC-003/SC-006 end-to-end with real files while
staying just above the threshold to keep writes fast (~1-2 s on SSD) and within
the 15 s vitest timeout. Threshold-enabling env overrides were explicitly
rejected — they turn a correctness gate into a test-only footgun in production.

**Alternatives considered**: env var to lower the threshold for tests — rejected
(production footgun, see D2); sparse/zero-filled 1 GiB files — rejected, invalid
content yields meaningless line structure; skipping large-file integration and
relying on mocked offsets only — rejected, the spec's acceptance scenarios are
end-to-end behaviors.

## Resolved unknowns summary

| Unknown (Technical Context) | Resolution |
|---|---|
| Sample count formula | D3: `clamp(ceil(F / 4 GiB), 20, 256)`, evenly spaced `floor(i * F / N)` |
| "Small" cutoff | D2: reuse `SMALL_FILE_BYTES_THRESHOLD` (1 GiB), skip entirely |
| Skipped-verdict semantics | D1/D2/D6: distinct tri-state, identical fallback to unsorted, neutral log |
| Cache staleness mechanism | D5: `.idx` version bump to V3, re-verify, re-stamp |
| Non-overlap enforcement | D4: runtime assertion, explicit error |
| Forced-mode behavior on small corpora | D6: refusal (spec edge case) |
| Best practices (deterministic sampling, bounded reads) | D3: fixed-offset strata, constant windows, no randomness |
| Patterns (cache invalidation) | D5: version marker reuses existing header validation path |
