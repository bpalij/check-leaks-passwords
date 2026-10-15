# Feature Specification: Improved Sortedness Check

**Feature Branch**: `002-improve-sortedness-check`

**Created**: 2026-10-15

**Status**: Draft

**Input**: User description: "sort check improvement according to discussion in context"

## Clarifications

### Session 2026-10-15

- **CL-001**: Q: When the improved check runs, what happens to a cached "sorted" verdict written by the older, weaker check before the corpus is re-verified? → A: Bump an algorithm/index version so caches from the old algorithm are treated as stale and re-verified, then re-stamped with the new version.
- **CL-002**: Q: For corpora at or below the full-coverage size, how should the whole corpus actually be examined? → A: Small corpora skip the check entirely and go straight to sequential read (reliable and fast); large corpora use deterministic sampling that verifies order within each sampled part and between sampled parts.
- **CL-003**: Q: Which size defines "small" (skip the check, read sequentially)? → A: Reuse the existing `SMALL_FILE_BYTES_THRESHOLD` of 1 GiB.
- **CL-004**: Q: How many regions should the deterministic check sample, fixed or scaled with file size? → A: Size-scaled but bounded: `N = clamp(ceil(F / 4 GiB), 20, 256)`, with evenly spaced deterministic offsets.
- **CL-005**: Q: What verdict should a skipped sub-threshold corpus report? → A: A distinct "skipped/unknown" verdict with a neutral log; it applies the same fallback as the unsorted case (invalidate `.idx` and use sequential read only).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Confident global order detection (Priority: P1)

A user points the tool at a hashes corpus. Before relying on order-dependent
reading, the tool reports whether the corpus is ordered consistently across the
whole file, not merely between neighbouring records.

**Why this priority**: Order-dependent reading silently produces wrong leak
results when the corpus is not globally sorted. Catching block-level disorder
protects correctness, the top project priority.

**Independent Test**: Reject a corpus made of internally-sorted blocks
concatenated out of order, and accept a genuinely sorted corpus.

**Acceptance Scenarios**:

1. **Given** a corpus whose higher-value region precedes a lower-value region,
   **When** the check runs, **Then** it reports the corpus as unsorted.
2. **Given** a strictly sorted corpus, **When** the check runs, **Then** it
   reports the corpus as sorted.
3. **Given** a corpus that is sorted only between neighbouring records but is
   reordered at block level, **When** the check runs, **Then** it reports the
   corpus as unsorted.

---

### User Story 2 - Reproducible verdicts (Priority: P2)

A user runs the check twice on the same unchanged corpus and receives the same
verdict both times.

**Why this priority**: Reproducibility is required for trust and for reliable
automated validation; the current check can vary between runs.

**Independent Test**: Run the check repeatedly on one corpus and compare the
verdicts.

**Acceptance Scenarios**:

1. **Given** an unchanged corpus, **When** the check runs multiple times,
   **Then** the verdict is identical every time.

---

### User Story 3 - Negligible cost and no redundant work (Priority: P3)

The added coverage does not noticeably slow the tool or increase memory use,
even on an ~89 GiB corpus, and small corpora are not sampled redundantly.

**Why this priority**: The check must stay far cheaper than the overall scan to
remain worthwhile.

**Independent Test**: Compare data read, peak memory and elapsed time before and
after the change on large and small corpora.

**Acceptance Scenarios**:

1. **Given** a large corpus, **When** the enhanced check runs, **Then**
   additional data read is a small bounded constant and memory use is unchanged.
2. **Given** a corpus below the 1 GiB threshold, **When** the check is invoked,
   **Then** no region sampling occurs and the corpus is read sequentially.

---

### Edge Cases

- **EC-001**: Corpora below the 1 GiB threshold skip the check, report "skipped",
  invalidate any `.idx`, and are read sequentially (single chunk) (see FR-011).
- **EC-002**: The sampled phase only runs at or above the 1 GiB threshold, so each
  region is guaranteed larger than one record and region reads cannot overlap
  under any valid configuration.
- **EC-003**: A stale cache written by the prior weaker algorithm is re-verified
  before a "sorted" verdict is trusted (see FR-008).
- **EC-004**: Forcing an order-dependent read mode (binary/index) on a
  sub-threshold corpus cannot rely on a "skipped" verdict; it is refused because
  sortedness is not established (see FR-016).
- **EC-005**: CRLF and LF line endings are both recognized, malformed/short lines
  are parsed per the existing rules without crashing, and duplicate values are
  permitted (see FR-017).
- **EC-006**: Empty files and files below the minimum accepted size continue to be
  rejected by the retained existing minimum-size guard, with observable behavior
  unchanged (see FR-011, which classifies all such files as "skipped").
- **EC-007**: A corpus mutated between verdict production and use within the same
  run is out of scope: the verdict is a point-in-time heuristic, and a byte change
  updates the corpus mtime so the cache is invalidated and the verdict re-derived
  on the next run (see FR-008).
- **EC-008**: After an "unsorted" or "skipped" verdict, order-dependent reading is
  not re-established for that run. Recovery occurs on a later run: a corrected
  corpus with a changed mtime is re-verified (see FR-008) and a "sorted" verdict
  may then enable order-dependent reading; sub-threshold corpora remain
  sequential-only permanently (see FR-011).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The check MUST verify ordering across regions distributed
  throughout the corpus, not only between neighbouring records; a representative
  value from an earlier region MUST NOT exceed a representative value from a
  later region. A region's **representative value** is the hash of the first
  complete line after line-boundary alignment within that region's read window
  (the partial leading line is skipped by scanning to the next newline). A
  window containing no complete line is an explicit failure reported as
  `unsorted` with a diagnostic — never a silent pass.
- **FR-002**: Region sampling MUST be deterministic — the same corpus yields the
  same sampled regions on every run. Regions MUST be selected as evenly spaced
  strata via fixed offsets, with no run-to-run randomness.
- **FR-003**: The check MUST report the corpus as unsorted when any earlier
  sampled region's representative value exceeds a later region's representative
  value.
- **FR-004**: The check MUST retain the existing local adjacent-order
  verification, including the retained head/tail windows and the new
  intra-region adjacency checks.
- **FR-005**: The check MUST use a bounded, constant amount of memory independent
  of corpus size.
- **FR-006**: The check MUST NOT read the entire corpus. For corpora below the
  1 GiB threshold it reads nothing extra and defers entirely to sequential
  reading; at or above the threshold it reads only bounded sampled regions plus
  bounded head/tail windows.
- **FR-007**: The check MUST produce a correct sorted/unsorted verdict only for
  corpora at or above the 1 GiB threshold (see FR-003); smaller corpora are
  reported as "skipped" per FR-011.
- **FR-008**: The check MUST remain compatible with the existing cached-verdict
  mechanism and all supported hash formats. Caches produced by the prior, weaker
  algorithm MUST be treated as stale (via an algorithm/index version marker),
  re-verified against the improved check, and then re-stamped; a pre-existing
  stale "sorted" flag MUST NOT be trusted.
  - **Version marker**: the algorithm/index version marker is the version byte at
    offset 1 of the existing 19-byte `.idx` header. The improved check stamps and
    requires `IDX_VERSION_V3` (`0x03`); a header whose version is `0x02` or a
    legacy value is always stale regardless of mtime, and its sorted flag is
    never trusted.
  - **Trust conditions**: a cached verdict is trusted **if and only if all** of
    the following hold: the `.idx` mtime is strictly newer than the corpus mtime,
    the version byte equals `0x03`, the hash type matches the corpus, the stored
    file size matches the actual corpus size, and the file is not truncated.
    Any condition failing ⇒ the cache is stale ⇒ live re-verification.
  - **Ordered re-verify-then-re-stamp sequence**: on a stale or missing cache the
    cached flag is treated as untrusted and the live check runs; if the live check
    itself fails with an I/O error, the error MUST surface explicitly (no verdict
    is produced and no re-stamp occurs); if the live check completes, its verdict
    is the result and the `.idx` is re-stamped with V3 on the next `.idx` write.
  - **Corrupted/unreadable header**: a corrupted, unreadable, or truncated
    `.idx` header is treated as stale (live re-verification), never trusted, and
    MUST NOT crash the scan.
  - **Distinct cache-path outcomes**: a fresh valid V3 cache hit with the flag set
    yields `sorted` and with the flag unset yields `unsorted`, both without corpus
    reads; a stale-version, stale-mtime, or missing cache yields a live-check
    verdict.
- **FR-009**: The check MUST NOT reject a genuinely sorted corpus (no new false
  rejections).
- **FR-010**: The check MUST produce reproducible results for identical inputs.
  **Identical inputs** means the same corpus bytes and the same corpus size:
  sampled offsets are a pure function of file size, so identical bytes and size
  yield identical sampled offsets, identical representative values, and an
  identical verdict on every run and every machine.
- **FR-011**: For corpora below the 1 GiB threshold the check MUST NOT run and
  MUST NOT report a sorted/unsorted verdict. It MUST report a distinct
  "skipped" outcome, invalidate any existing `.idx` cache, and defer to
  sequential read only (such corpora are already processed as a single sequential
  chunk).
- **FR-012**: Region sampling MUST run only for corpora at or above the 1 GiB
  threshold. The number of sampled regions MUST be deterministic and size-scaled
  as `N = clamp(ceil(F / 4 GiB), 20, 256)` using evenly spaced strata. The
  non-overlap condition `fileSize ≥ N × max(SORTEDNESS_REGION_READ_BYTES,
  MAX_LINE_BYTES)` — `max(4096, 256)` bytes respectively; see plan.md — MUST be
  enforced by construction and additionally validated at runtime, never merely
  assumed. The condition holds by construction for every configuration at or
  above the 1 GiB floor (at most `256 × 4096` bytes). Equality is permitted:
  when `fileSize` equals `N × window`, adjacent read windows exactly abut with
  no overlap and no duplicate reads.
- **FR-013**: Within each sampled region, adjacency MUST be verified (local
  order), in addition to the cross-region ordering required by FR-001/FR-003.
- **FR-014**: The "skipped" outcome MUST be distinguishable from both "sorted"
  and "unsorted" in the reported result, while applying the identical fallback
  to "unsorted" (invalidate `.idx`, sequential read only) with a neutral log
  message that does not claim the corpus is unsorted.
- **FR-015**: Sampled hash values MUST NOT be logged, persisted, or written to
  any output; they are used only in memory for order comparison and discarded.
  Log lines MUST state the verdict only.
- **FR-016**: Refusal and error behavior MUST be explicit:
  - Forcing an order-dependent read mode (`binary`, `index`,
    `sequential-index`) when the verdict is `skipped` MUST fail with an error
    distinguishable as "not verified (file below 1 GiB)" from the "not sorted"
    message.
  - `build-index` on a `skipped` corpus MUST report an error to stderr (cannot
    verify sortedness below 1 GiB) and exit with code 1.
  - A non-overlap invariant violation MUST throw an explicit `Error` naming the
    invariant; the check MUST NOT continue with overlapping region reads.
  - A short or truncated region read during the live check MUST NOT be treated as
    a pass: a window containing no complete line follows FR-001 (`unsorted` with a
    diagnostic), and any other I/O failure surfaces explicitly (see FR-008).
- **FR-017**: Line-boundary and record-format handling MUST follow existing
  conventions: LF and CRLF line endings are both recognized, malformed or short
  lines are parsed per the existing rules without crashing, duplicate values are
  permitted, and value comparison and case handling are unchanged (see
  Assumptions).

### Key Entities

- **Hashes corpus**: An ordered text corpus of hash records.
- **Region sample (anchor)**: A representative record value drawn from one of the
  deterministic, evenly spaced strata; each region's internal adjacency is also
  verified.
- **Sortedness verdict**: One of sorted, unsorted, or skipped (corpus below the
  1 GiB threshold). Only "sorted" enables order-dependent reading; "unsorted"
  and "skipped" both invalidate the index and use sequential read only.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of block-reordered test corpora are correctly rejected. A
  block-reordered corpus is constructed as two or more internally-ascending
  segments (each sorted on its own) concatenated in an order that is not globally
  ascending.
- **SC-002**: 0 false rejections across the sorted-corpus regression suite. The
  suite comprises the existing sorted-hash fixtures plus the generated
  strictly-sorted corpora used by the integration tests (see quickstart.md).
- **SC-003**: Repeated checks of identical input produce identical verdicts
  (100% agreement).
- **SC-004**: Additional data read stays bounded (at most 256 sampled regions;
  ≤ `N × 4096 + 2 × 8000` bytes) for corpora at or above the 1 GiB threshold.
  The "< 1% runtime" target is tracked as a plan-level performance goal, not a
  hard success criterion.
- **SC-005**: The check allocates only fixed-size buffers independent of corpus
  size: every read request is bounded by the fixed region/head-tail window and no
  allocation scales with corpus size. Verified deterministically via
  read-request inspection; exact peak-RSS measurement is intentionally out of
  scope as environment-dependent and unreliable.
- **SC-006**: For every boundary input: corpora below 1 GiB are reported as
  "skipped" and read sequentially without running the check; corpora at or above
  1 GiB receive a correct sorted/unsorted verdict.
- **SC-007**: No overlapping or duplicate region reads for any sampled corpus:
  `fileSize ≥ N × max(SORTEDNESS_REGION_READ_BYTES, MAX_LINE_BYTES)` holds for
  every sampled corpus size and the derived `N`.

### Requirement Traceability

Each success criterion maps to the functional requirements it gates:

| Success criterion | Gated functional requirements |
|---|---|
| SC-001 block-reordered corpora rejected | FR-001, FR-003, FR-013 |
| SC-002 no false rejections | FR-009 |
| SC-003 reproducibility | FR-002, FR-010 |
| SC-004 bounded additional read | FR-006 |
| SC-005 fixed-size buffers | FR-005 |
| SC-006 boundary behavior | FR-007, FR-011 |
| SC-007 no overlapping regions | FR-012 |

## Assumptions

- Corpora are up to ~89 GiB today and may grow 5–10×; the design must remain
  size-independent.
- The check remains a heuristic safeguard, not a cryptographic or security
  guarantee. Deliberate forging of a sorted-looking corpus is out of scope,
  because such an actor already controls the data. This limitation was explicitly
  accepted as the stakeholder decision on 2026-10-15.
- An inversion confined strictly between two sampled regions may remain
  undetected; this residual limitation is accepted. Detection strength is bounded
  by sample count, so it improves with `N` but is never absolute.
- The minimum accepted size threshold is NOT raised. "Small" for the purpose of
  skipping the check reuses the existing 1 GiB `SMALL_FILE_BYTES_THRESHOLD`;
  safety below it comes from always reading sequentially, not from a larger
  threshold.
- Sample count is `N = clamp(ceil(F / 4 GiB), 20, 256)`: the 20 floor keeps
  overhead negligible at the 1 GiB boundary and the 256 cap keeps overhead
  bounded on the largest corpora.
- The 4 GiB strata divisor sets a sampling density of roughly one region per
  4 GiB: the current ~89 GiB corpus yields `N ≈ 23` regions spread across the
  whole file, the 1 GiB boundary yields the 20-region floor, and the 256 cap
  engages at 1 TiB. This balances detection coverage against a bounded read cost
  (see SC-004).
- The non-overlap invariant is guaranteed at the 1 GiB floor for any bounded
  window and the capped `N`, but it is still validated at runtime rather than
  assumed.
- Skipping below the threshold and the version-gated cache re-verification are
  intended behavior; they are recorded so downstream planning does not
  re-introduce whole-file reads for small corpora or trust legacy sorted flags
  (see FR-011 and FR-008).
- Value comparison follows existing conventions (case handling, ordering, and
  duplicate values permitted).
