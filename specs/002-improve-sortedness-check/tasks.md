---

description: "Task list for Improved Sortedness Check"

---

# Tasks: Improved Sortedness Check

**Input**: Design documents from `/specs/002-improve-sortedness-check/`

**Prerequisites**: plan.md, spec.md, data-model.md, contracts/sortedness-contract.md, research.md, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing. Tests are included: they are explicitly requested by the plan and research (D8) and required by Constitution Principle VI.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Single-project CLI layout: `src/`, `tests/` at repository root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish a green baseline and introduce shared constants/types

- [X] T001 Verify Node.js satisfies `engines` (`>=26`, `.nvmrc`) and run `npm ci`; capture baseline `npm run lint`, `npm run typecheck`, `npm run test:coverage` all green before any change
- [X] T002 [P] In `src/constants.ts` add JSDoc'd `SORTEDNESS_SAMPLE_STRATA_BYTES` (4 GiB = 4 * 1024 * 1024 * 1024), `SORTEDNESS_MIN_REGIONS` (20), `SORTEDNESS_MAX_REGIONS` (256), `SORTEDNESS_REGION_READ_BYTES` (4096), `IDX_VERSION_V3` (0x03); remove `SORTEDNESS_CHECK_PAIRS`
- [X] T003 [P] In `src/types.ts` add `export type SortednessVerdict = 'sorted' | 'unsorted' | 'skipped'` with JSDoc documenting the distinct `skipped` fallback semantics (FR-014)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Deterministic sampling core and V3 cache gate — blocks all user stories

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 [P] Add unit tests for the pure sampling math in `src/hashing/sortednessSampling.unit.test.ts`: `computeRegionCount` clamps (1 GiB → 20, ~80 GiB → 20, >= 1 TiB → 256); `computeSampleOffsets` is evenly spaced `floor(i * F / N)` with first offset 0
- [X] T005 [P] Implement `computeRegionCount(fileSize)` and `computeSampleOffsets(fileSize, count)` in new `src/hashing/sortednessSampling.ts` (pure, I/O-free, JSDoc, named exports)
- [X] T006 Implement `readRegionSample(fd, offset, hashLength)` in `src/hashing/sortednessSampling.ts`: skip the partial first line (scan to next newline), verify intra-region adjacency across all complete lines (FR-013), and return `{ anchor, adjacentInRegion }`; a window containing no complete line is an explicit failure, never a silent pass (contract §5)
- [X] T007 Enforce the runtime non-overlap invariant `fileSize >= N * max(SORTEDNESS_REGION_READ_BYTES, MAX_LINE_BYTES)` in `src/hashing/sortednessSampling.ts`, throwing an explicit `Error` naming the invariant — never silently clamping (FR-012, SC-007, D4)
- [X] T008 [P] Bump the `.idx` header to V3 in `src/io/indexHeader.ts`: `encodeIndexHeader` stamps `IDX_VERSION_V3` and `checkIndexHeader` requires `IDX_VERSION_V3` (V2/legacy → stale); update expectations in `src/io/indexHeader.unit.test.ts` (FR-008, D5)
- [X] T009 Upgrade the `.idx` cache-read path in `src/hashing/detectSortedness.ts` from a raw byte-0 read to `decodeIndexHeader` + V3 version check (the 19-byte header is already read — zero extra I/O); a V2/legacy header is re-verified, never trusted (FR-008)

**Checkpoint**: Deterministic sampling and V3 cache staleness ready — user story implementation can begin

---

## Phase 3: User Story 1 - Confident global order detection (Priority: P1) 🎯 MVP

**Goal**: Reject block-reordered corpora and accept genuinely sorted ones using deterministic cross-region sampling with a tri-state verdict. A corpus at or above 1 GiB receives an accurate `sorted`/`unsorted` verdict; a corpus below 1 GiB reports `skipped` and is read sequentially.

**Independent Test**: A >= 1 GiB corpus made of two internally-sorted halves written in reverse reports `unsorted`; a genuinely sorted corpus reports `sorted`; a < 1 GiB corpus reports `skipped` and is read sequentially.

### Tests for User Story 1 (write first, ensure they FAIL) ⚠️

- [X] T010 [P] [US1] Unit tests with mocked `fd` in `src/hashing/detectSortedness.unit.test.ts`: sorted → `sorted`, unsorted → `unsorted`, < 1 GiB → `skipped` (no reads, no `.idx` consult), fresh V3 `.idx` with flag set → `sorted`, V2 header → re-verify; assert captured stdout contains no hash substrings (FR-015)
- [X] T011 [P] [US1] Integration test in `src/hashing/detectSortedness.integration.test.ts`: generate ~1.05 GiB corpora in `os.tmpdir()` via chunked writes; sorted → `sorted`; two sorted halves reversed → `unsorted` (SC-001); remove files in `afterEach`; stay within the vitest timeout

### Implementation for User Story 1

- [X] T012 [US1] Rewrite `detectSortedness` in `src/hashing/detectSortedness.ts`: skip gate first (`fileSize < SMALL_FILE_BYTES_THRESHOLD` → `skipped`, no reads, no cache consult; D2), V3 cache gate (T009), retain the 8000-byte head/tail windows (FR-004), sample N regions via `sortednessSampling` (T005–T007), then derive the verdict (`adjacentInRegion` fail → `unsorted`; `anchor[i] > anchor[j]` for `i < j` → `unsorted`; else `sorted`); return `SortednessVerdict`
- [X] T013 [US1] Update `detectSortednessAndCleanup` in `src/io/modeResolver.ts` to return `SortednessVerdict`: `sorted` → `File sorted: yes` (keep `.idx`); `unsorted` → `File sorted: no` followed by `Warning: file not sorted` (unlink `.idx`); `skipped` → `File < 1 GiB — sortedness check skipped; sequential read only` (unlink `.idx`, neutral message with no "not sorted")
- [X] T014 [US1] Update `src/io/processSingleFile.ts` verdict mapping: `skipped` → `runSequential(false, false)`; forced modes (`binary`/`index`/`sequential-index`) on `skipped` throw a refusal distinct from the unsorted message ("not verified (file below 1 GiB)"); update the small-file/chunk-override paths (D6)
- [X] T015 [US1] Update `src/scripts/buildIndex.ts` to refuse on `skipped` with a clear stderr message ("cannot verify sortedness below 1 GiB") and exit code 1 (D6)
- [X] T016 [P] [US1] Update `src/io/modeResolver.unit.test.ts` for the tri-state verdict and the `skipped` log/unlink path
- [X] T017 [P] [US1] Update `src/io/processSingleFile.unit.test.ts` mocks/expectations for `SortednessVerdict` and the forced-mode `skipped` refusal
- [X] T018 [P] [US1] Update `src/scripts/buildIndex.integration.test.ts` for the `skipped` refusal and the V3 byte-1 assertion
- [X] T019 [P] [US1] Update `src/io/processSingleFile.integration.test.ts` and `src/io/integration-readers.integration.test.ts` for the V3 header and tri-state cache behavior

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Reproducible verdicts (Priority: P2)

**Goal**: Identical corpus bytes and size yield identical sampled offsets, anchors, and verdict on every run and machine (no randomness).

**Independent Test**: Run the check repeatedly on one unchanged corpus and compare the verdicts — they are identical every time.

- [X] T020 [P] [US2] Unit test in `src/hashing/sortednessSampling.unit.test.ts`: `computeSampleOffsets` returns identical output across repeated calls for the same `fileSize` (FR-002, SC-003)
- [X] T021 [P] [US2] Integration test in `src/hashing/detectSortedness.integration.test.ts`: run `detectSortedness` twice on the same >= 1 GiB corpus and assert identical verdicts (SC-003)
- [X] T022 [US2] Audit `src/hashing/detectSortedness.ts` and `src/hashing/sortednessSampling.ts` to confirm no `Math.random`/time-based input participates in sampling (grep and remove any residual); offsets must be derived purely from `fileSize` (FR-002, FR-010)

**Checkpoint**: Determinism verified; builds on the US1 entry-point rewrite

---

## Phase 5: User Story 3 - Negligible cost and no redundant work (Priority: P3)

**Goal**: The added coverage adds a small bounded constant of reads and no size-proportional memory growth, and small corpora are never sampled.

**Independent Test**: For large corpora, inspect the mocked `fd` read requests to confirm a bounded, fixed-size read budget; for small corpora, confirm no reads occur.

- [X] T023 [P] [US3] Unit test in `src/hashing/detectSortedness.unit.test.ts`: for a < 1 GiB file, assert the skip gate performs zero `fd.read` calls and never opens or consults `.idx` (FR-006, FR-011, SC-006)
- [X] T024 [P] [US3] Unit test in `src/hashing/sortednessSampling.unit.test.ts`: `computeRegionCount` never exceeds `SORTEDNESS_MAX_REGIONS` (256) and the derived read budget stays `<= N * 4096 + 16000` bytes (SC-004, contract §4)
- [X] T025 [US3] Ensure the skip gate is ordered before any `.idx` stat/read or corpus read in `src/hashing/detectSortedness.ts`, so small corpora incur no redundant work (D2)
- [X] T026 [P] [US3] Memory-bound test in `src/hashing/detectSortedness.unit.test.ts`: with a mocked `fd` reporting a huge `fileSize`, assert every `fd.read` request is fixed-size (≤ `SORTEDNESS_REGION_READ_BYTES` / head-tail window) and total requested bytes stay `<= N * SORTEDNESS_REGION_READ_BYTES + 2 * 8000`, proving no allocation scales with corpus size (FR-005, SC-005); do NOT measure RSS/heap — exact memory footprint is environment-dependent and intentionally out of scope

**Checkpoint**: Cost bound verified; all three stories are independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation and validation gates

- [X] T027 [P] Update `specs/002-improve-sortedness-check/quickstart.md` / `README.md` references to the tri-state verdict and V3 header if wording has drifted
- [X] T028 Run full validation gates: `npm run lint`, `npm run typecheck`, `npm run test:coverage` (coverage >= 90%; do not lower thresholds) (Principle VII)
- [X] T029 Final correctness/security review: confirm no sampled hash values are logged (Principle II, FR-015), no whole-corpus reads occur, corrupted `.idx`/no-line windows fail explicitly, and no unrelated changes were introduced (Principles I, IV)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on the Foundational phase
  - US1 (P1) is the MVP; US2 (P2) and US3 (P3) layer verification on the US1 entry-point rewrite
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) — no dependencies on other stories
- **User Story 2 (P2)**: After Foundational + the US1 entry-point rewrite (determinism is realized by `sortednessSampling` and `detectSortedness`)
- **User Story 3 (P3)**: After Foundational + the US1 skip gate

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Sampling math before region reads; region reads before orchestration; orchestration before caller mapping
- Story complete before moving to the next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel (T002, T003)
- Foundational tasks marked [P] can run in parallel (T004, T005, T008)
- Once Foundational completes, US1 can begin
- All tests for a story marked [P] can run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch the US1 tests together (write first, they must fail):
Task: "Unit tests for detectSortedness tri-state in src/hashing/detectSortedness.unit.test.ts"
Task: "Integration test >=1 GiB sorted/reversed in src/hashing/detectSortedness.integration.test.ts"

# Launch the US1 caller-test updates together:
Task: "Update src/io/modeResolver.unit.test.ts for tri-state"
Task: "Update src/io/processSingleFile.unit.test.ts for tri-state"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently
4. Add User Story 3 → Test independently
5. Polish and run validation gates

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1
   - Developer B: User Story 2 (after US1 entry-point rewrite)
   - Developer C: User Story 3 (after US1 skip gate)

---

## Notes

- [P] tasks = different files, no dependencies
- `[Story]` label maps a task to a specific user story for traceability
- `skipped` and `unsorted` apply the identical fallback (invalidate `.idx`, sequential read only); the `skipped` log is neutral
- Only `sorted` enables order-dependent reading (binary/index) or an `.idx` build
- Key paths: new `src/hashing/sortednessSampling.ts`; modified `src/hashing/detectSortedness.ts`, `src/io/{modeResolver,processSingleFile,indexHeader}.ts`, `src/scripts/buildIndex.ts`, `src/{constants,types}.ts`
