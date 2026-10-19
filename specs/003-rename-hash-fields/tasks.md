---

description: "Task list template for feature implementation"
---

# Tasks: Algorithm-Named Hash Fields in Output

**Input**: Design documents from `/specs/003-rename-hash-fields/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/output-fields-contract.md, quickstart.md

**Tests**: Included — explicitly required by plan.md Constitution gate VI and research.md D6 ("Tests assert it directly": legacy-name absence, position retention, single-token-per-file invariant).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

## Path Conventions

Single project: `src/`, `tests/` at repository root (per plan.md Project Structure).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Environment verification, baseline capture, green starting point

- [X] T001 Verify Node.js version per `.nvmrc` (26) satisfies `package.json` `engines` and install dependencies with `npm ci` in repository root
- [X] T002 [P] Capture baseline pre-change outputs (one SHA-1 run and one NTLM run, CSV + JSON formats) as `pre-*` reference files per `specs/003-rename-hash-fields/quickstart.md` prerequisites — required for SC-004 byte-stability diffing in Phase 5
- [X] T003 [P] Establish green baseline in repository root: `npm run lint`, `npm run typecheck`, `npm run test:coverage` all pass with coverage ≥ 90%

**Checkpoint**: Environment verified, baselines captured, validation gates green before any change

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared test infrastructure required by BOTH user stories' test suites

**⚠️ CRITICAL**: No user story test work can begin until this phase is complete

- [X] T004 [P] Add shared output-field assertion helper `assertSingleAlgorithmToken(fileFieldNames)` (requires exactly one distinct `sha1`/`ntlm` token across all `login_password_*`/`hash_*` field names) and `assertLegacyFieldsAbsent(fileFieldNames)` (requires `login_password_hash`, `login_password_hash_type`, group-level `hash` all absent) in `tests/helpers/outputFields.ts` per research.md D6

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 - Algorithm-named hash fields in output files (Priority: P1) 🎯 MVP

**Goal**: Every hash-value field in CSV/JSON output is named with the run's effective algorithm token (`login_password_sha1`/`login_password_ntlm` per record, `hash_sha1`/`hash_ntlm` per JSON group), derived from `OutputHandlerOptions.hashType` (FR-001, FR-002, FR-004)

**Independent Test**: Run scans producing CSV and JSON output for one SHA-1 run and one NTLM run; verify every hash-value field name contains the corresponding algorithm token and still holds the hash value as before, with all other content unchanged (spec US1 Independent Test)

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T005 [P] [US1] Update CSV writer unit tests in `src/handlers/csv/csv.unit.test.ts`: header assertion at L213 expects `login_password_sha1` (and `login_password_ntlm` variant) in place of `login_password_hash` at its former index, no column named `login_password_hash`, hash values unchanged; apply `assertSingleAlgorithmToken`/`assertLegacyFieldsAbsent` from `tests/helpers/outputFields.ts`
- [X] T006 [P] [US1] Update JSON writer unit tests in `src/handlers/json/json.unit.test.ts`: record assertions at L618/L682/L690/L800 expect `login_password_<alg>`, group assertion at L615 expects `hash_<alg>` as first key, legacy names absent (keep `login_password_hash_type` assertions — removal is US2); apply shared helpers from `tests/helpers/outputFields.ts`
- [X] T007 [P] [US1] Update `tests/checkPasswordsLeaks.integration.test.ts`: record `login_password_hash` assertions (L86, L127, L316, L357) and group-level `output[0].hash` assertions (L645, L993, L1408) → algorithm-named fields, including warn-mode corrected run (asserts effective, not requested, token — SC-005); also extend the 'API + auto resolves to sha1' test (`checkPasswordsLeaks.integration.test.ts` L1283): read the written `outputPath` JSON and assert `login_password_sha1` on records and `hash_sha1` on groups, legacy names absent (SC-005 API-mode half)
- [X] T008 [US1] Update group-level `output[0].hash` assertion at `tests/ntlm-quickstart.integration.test.ts:102` → `hash_ntlm` (leave `login_password_hash_type` assertions at L107/L125/L145/L180 for US2)

### Implementation for User Story 1

- [X] T009 [US1] In `src/handlers/csv/write.ts`: convert `COLUMNS_ORDER` (L9-31) to `buildCsvColumnOrder(hashType)` that splices `login_password_${hashType}` at `login_password_hash`'s former index (L17) while retaining the `login_password_hash_type` entry for now (US2 removes it); emit `login_password_${hashType}: hash` per row instead of `login_password_hash` (L148)
- [X] T010 [US1] In `src/handlers/json/write.ts`: convert `JSON_KEY_ORDER_NESTED` (L14-15) and `JSON_KEY_ORDER_FLAT` (L50-51) to `buildJsonKeyOrderNested(hashType)`/`buildJsonKeyOrderFlat(hashType)` splicing `login_password_${hashType}` at `login_password_hash`'s former index (retain `login_password_hash_type` entry for now); emit `login_password_${hashType}: group.hash` per record (L161); also update the `writeJsonOutputFile` JSDoc (`json/write.ts` L135-136) to reference `login_password_<alg>` instead of `login_password_hash`
- [X] T011 [US1] In `src/handlers/json/write.ts`: replace the `...group` spread (L155-156) with explicit object literal `{ [`hash_${hashType}`]: group.hash, leaks: group.leaks, passwordObjects: ... }` pinning group key order `hash_<alg>`, `leaks`, `passwordObjects` per research.md D3 (depends on T010 — same file)

**Checkpoint**: At this point, User Story 1 is fully functional and testable independently — all hash fields carry the effective algorithm token; `login_password_hash_type` still emitted (US2 removes it)

---

## Phase 4: User Story 2 - Removal of the redundant hash-type field (Priority: P2)

**Goal**: `login_password_hash_type` is no longer emitted in CSV or JSON; documentation and shipped tooling reference only the new field names (FR-003, FR-007, FR-008)

**Independent Test**: Produce output in both formats and assert that no field named `login_password_hash_type` exists while the algorithm-carrying hash field names are present (spec US2 Independent Test)

**Depends on**: User Story 1 complete (rename must land before legacy references can be swept)

### Tests for User Story 2 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T012 [P] [US2] Update `src/handlers/csv/csv.unit.test.ts`: replace `login_password_hash_type` presence assertions with absence assertions (no `login_password_hash_type` in headers) plus `assertLegacyFieldsAbsent` from `tests/helpers/outputFields.ts`
- [X] T013 [P] [US2] Update `src/handlers/json/json.unit.test.ts`: replace `login_password_hash_type` presence assertions at L619/L636 with absence assertions (no `login_password_hash_type` in records) plus `assertLegacyFieldsAbsent`
- [X] T014 [P] [US2] Update `tests/checkPasswordsLeaks.integration.test.ts`: `login_password_hash_type` assertions at L941, L996, L1329, L1414 → assert the record field name carries the effective algorithm token instead (SC-005 preserved)
- [X] T015 [P] [US2] Update `tests/ntlm-quickstart.integration.test.ts`: `login_password_hash_type` assertions at L107, L125, L145, L180 → field-name token assertions (`login_password_ntlm` / `login_password_sha1`)

### Implementation for User Story 2

- [X] T016 [US2] In `src/handlers/csv/write.ts`: delete the `login_password_hash_type: hashType` emission (L149) and the `login_password_hash_type` entry in `buildCsvColumnOrder` (per data-model.md: "not emitted"; FR-003)
- [X] T017 [US2] In `src/handlers/json/write.ts`: delete the `login_password_hash_type: hashType` emission (L162) and its entries in `buildJsonKeyOrderNested`/`buildJsonKeyOrderFlat` (guarantees it can never reappear via the unknown-keys-alphabetical path — research.md D2)
- [X] T018 [US2] Rewrite `OutputHandlerOptions.hashType` JSDoc in `src/types.ts` (L147-159 and the property comment at the type): document `hashType` as the sole input to `login_password_<alg>`/`hash_<alg>` field naming; remove the stale promise of a per-record `login_password_hash_type` column (research.md D4, Principle V)
- [X] T019 [P] [US2] Update `README.md` L77 (remove `login_password_hash_type` mention, describe algorithm-derived field names) and L244 (`login_password_hash` → `login_password_sha1`/`login_password_ntlm` field list) per FR-007 — zero remaining references to legacy names; `manual-testing-*/reports/*.md` are exempt and must NOT be edited
- [X] T020 [P] [US2] Update `normalize()` in `manual-testing-sha1/scripts/compare-outputs.mjs` (L70-73): `hash = obj.login_password_sha1 ?? obj.login_password_ntlm ?? group.hash_sha1 ?? group.hash_ntlm ?? ''` and infer `hashType` from which field is present (`'login_password_ntlm' in obj || 'hash_ntlm' in group ? 'ntlm' : 'sha1'`); no legacy fallbacks (research.md D5, FR-008)
- [X] T021 [P] [US2] Apply the same `normalize()` rewrite as T020 in `manual-testing-ntlm/scripts/compare-outputs.mjs` (L75-78)
- [X] T022 [P] [US2] Apply the same `normalize()` rewrite as T020 in `manual-testing-ntlm/scripts/compare-cross-plan.mjs` (L61-68)

**Checkpoint**: Both user stories complete — output, docs, and tooling carry only algorithm-named hash fields

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Validation gates, stale-reference sweep, end-to-end conformance

- [X] T023 Run full validation gates in repository root: `npm run lint`, `npm run typecheck`, `npm run test:coverage` — zero errors, coverage ≥ 90% statements/branches/functions/lines (do not lower thresholds in `vitest.config.ts`)
- [X] T024 [P] Stale-reference sweep per SC-006/quickstart §4: `grep -rn 'login_password_hash' README.md manual-testing-*/scripts/` → empty; `grep -rn 'login_password_hash\|login_password_hash_type' README.md` → empty; `grep -rn 'login_password_hash\|login_password_hash_type' src/` → empty; `git status manual-testing-*/reports/` shows no modifications (exempt)
- [X] T025 Run `specs/003-rename-hash-fields/quickstart.md` §2-4 end-to-end: targeted vitest suites, CLI e2e (`npm run build` + sha1/ntlm runs, `head -1` header checks, legacy-name grep on outputs), byte-stability `diff pre-<run>.csv <run>.csv` (only renamed/removed fields differ — SC-004), all three compare scripts run cleanly on fresh outputs
- [X] T026 [P] Review final diff against `specs/003-rename-hash-fields/contracts/output-fields-contract.md` §1-3 (CSV header order, JSON group/record key order, naming-input table) and spec acceptance scenarios 1-5; confirm plan.md Constitution gates I-VII still hold

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion (T004) — BLOCKS all user story test tasks
- **User Story 1 (Phase 3)**: Depends on Foundational (T004); tests (T005-T008) before implementation (T009-T011)
- **User Story 2 (Phase 4)**: Depends on User Story 1 (rename must exist before removal/tooling sweep); tests (T012-T015) before implementation (T016-T022)
- **Polish (Phase 5)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Foundational — no dependencies on other stories
- **User Story 2 (P2)**: Starts after US1 (spec: "cleanup that follows directly from US1"; independent test requires algorithm-carrying names present)
- **Polish**: After both stories

### Within Each User Story

- Tests written and FAILING before implementation
- Order-array builders before row/record emission changes (CSV: T009 single task; JSON: T010 before T011 — same file)
- Story complete before moving to next priority

### Parallel Opportunities

- Phase 1: T002 ∥ T003 after T001
- Phase 2: T004 alone
- US1 tests: T005 ∥ T006 ∥ T007 ∥ T008 (four different files); US1 impl: T009 ∥ T010 (different files), T011 after T010
- US2 tests: T012 ∥ T013 ∥ T014 ∥ T015 (four different files); US2 impl: T016 ∥ T017 ∥ T018 ∥ T019 ∥ T020 ∥ T021 ∥ T022 are all different files (T019-T022 independent of code changes)
- Polish: T024 ∥ T026; T023 before T025

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together (4 different files):
Task: "Update CSV writer unit tests in src/handlers/csv/csv.unit.test.ts"
Task: "Update JSON writer unit tests in src/handlers/json/json.unit.test.ts"
Task: "Update tests/checkPasswordsLeaks.integration.test.ts"
Task: "Update tests/ntlm-quickstart.integration.test.ts"

# Launch independent implementation tasks (2 different files):
Task: "buildCsvColumnOrder(hashType) + row emission in src/handlers/csv/write.ts"
Task: "buildJsonKeyOrder*(hashType) + record emission in src/handlers/json/write.ts"
# Then sequentially:
Task: "Group-level explicit literal in src/handlers/json/write.ts (depends on previous)"
```

## Parallel Example: User Story 2

```bash
# Launch all tests for User Story 2 together (4 different files):
Task: "Update src/handlers/csv/csv.unit.test.ts hash_type absence"
Task: "Update src/handlers/json/json.unit.test.ts hash_type absence"
Task: "Update tests/checkPasswordsLeaks.integration.test.ts"
Task: "Update tests/ntlm-quickstart.integration.test.ts"

# Launch implementation — all distinct files:
Task: "Remove hash_type emission in src/handlers/csv/write.ts"
Task: "Remove hash_type emission in src/handlers/json/write.ts"
Task: "Rewrite JSDoc in src/types.ts"
Task: "Update README.md L77/L244"
Task: "Update manual-testing-sha1/scripts/compare-outputs.mjs"
Task: "Update manual-testing-ntlm/scripts/compare-outputs.mjs"
Task: "Update manual-testing-ntlm/scripts/compare-cross-plan.mjs"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (baselines are mandatory before any edit)
2. Complete Phase 2: Foundational (T004 — blocks story tests)
3. Complete Phase 3: User Story 1 (tests first, then writers)
4. **STOP and VALIDATE**: quickstart §2 targeted suites + §4 byte-stability diff on `pre-*` baselines
5. Demo: SHA-1 and NTLM runs show algorithm-named fields

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. Add User Story 1 → test independently → deploy/demo (MVP — hash fields renamed, `hash_type` still present)
3. Add User Story 2 → test independently → deploy/demo (redundant field removed, docs/tooling updated)
4. Polish → full validation gates + quickstart end-to-end

### Notes

- [P] tasks = different files, no dependencies
- [Story] labels map tasks to spec user stories for traceability
- `manual-testing-*/reports/*.md`, `manual-testing-*/output/*`, internal `HashWithLeaksAndPasswordObjects.hash`, console/dry-run text, and `.idx` headers are OUT OF SCOPE (research.md D7, spec Assumptions)
- Clean break: no aliases or dual emission of legacy names (spec Assumptions)
- Commit after each task or logical group; stop at each checkpoint to validate the story independently

---

## Phase 6: Convergence

- [X] T027 Review the unrequested out-of-scope working-tree changes (`.gitignore`, `eslint.config.mjs`, `src/io/processHibpApi.ts`, new `src/packageVersion.ts`(+test), `src/memory/secureCleanup.ts`(+test)) — justify as intentional separate work and commit/split them separately from this feature, or remove them before merging (plan: Source Code scope) (unrequested)

---

## Phase 7: Convergence

- [X] T028 Complete T027's outstanding split-out action: the unrequested out-of-scope working-tree changes (`.gitignore`, `eslint.config.mjs`, `src/io/processHibpApi.ts`, `src/memory/secureCleanup.ts` + test, `src/packageVersion.ts` + test) remain uncommitted and interleaved with this feature's changes — commit/split them as separate intentional work or remove them before merging (T027; plan: Source Code scope) (done — split into 3b51ce5)
