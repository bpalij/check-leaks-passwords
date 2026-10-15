# Tasks: NTLM Hash Support

**Input**: Design documents from `/specs/001-ntlm-hash-support/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/config.md, quickstart.md

**Tests**: Tests ARE required — spec.md marks testing as mandatory and SC-005 requires new automated tests for the NTLM file, split-directory, and API paths (plus AGENTS.md testing discipline).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Baseline verification and feature branch preparation

- [X] T001 Verify the feature branch `001-ntlm-hash-support` exists, confirm Node.js >= 26 via `.nvmrc` (prefer `nvm use`), run `npm i`, and record a green baseline by running `npm run build:worker`, `npm run typecheck`, `npm run lint`, and `npm test` before any feature changes

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Types, constants, config/env, NTLM hashing, and content-based hash-type detection that MUST be complete before ANY user story

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Tests for Foundational (write FIRST, ensure they FAIL) ⚠️

- [X] T002 [P] Write FAILING unit tests for NTLM hashing against the quickstart.md reference vectors in src/hashing/hashPassword.unit.test.ts — `password` → `8846F7EAEE8FB117AD06BDD830B7586C`, `00000000` → `9BDC61DB5A3FCED6D82D49279F1F0430`, `123456` → `32ED87BDB5FDC5E9CBA88547376818D4`, `letmein` → `BECEDB42EC3C5C7F965255338BE4453C`, `password123` → `A9FDFA038C4B75EBC76DC855DD74F0DA` (uppercase hex)
- [X] T003 [P] Write FAILING unit tests for `HASH_TYPE` (`auto` default, `sha1`, `ntlm`) and `HASH_TYPE_MISMATCH` (`error` default, `warn`) parsing and validation — invalid values rejected with a message naming valid options — in src/envLoader.unit.test.ts and src/validateConfig.unit.test.ts
- [X] T004 [P] Write FAILING unit tests for content-based hash-type detection in src/hashing/detectHashType.unit.test.ts — single-file hash-part length before the separator 40 → sha1 / 32 → ntlm; split-dir suffix length 35 → sha1 / 27 → ntlm; CRLF/LF and blank lines ignored; detection never derived from file names; unknown/ambiguous detection returned as explicit states (FR-012)

### Implementation for Foundational

- [X] T005 [P] Add hash-type types to src/types.ts: `export type HashType = 'sha1' | 'ntlm' | 'auto'`, `export type HashTypeMismatchMode = 'error' | 'warn'`, and a single canonical `ActiveHashInfo` interface per data-model.md (`requested`, `type`, `fullHashLength` 40/32, `apiSuffixLength` 35/27, `source` `'explicit'|'detected'|'corrected'`, `mismatchMode`) — do NOT introduce a separate `HashTypeConfig` (consolidated away); extend `ConfigInterface` with `hashType: HashType` and `hashTypeMismatch: HashTypeMismatchMode`; generalize `HashLookupEntry.fullHashBytes` doc (no longer always 40 bytes). Add JSDoc to all new exported types.
- [X] T006 [P] Add constants to src/constants.ts: `NTLM_HEX_LENGTH = 32`, `NTLM_API_HASH_SUFFIX_LENGTH = 27`, hash-type-derived length helpers (fullHashLength and apiSuffixLength for sha1/ntlm), and new `.idx` header layout constants per data-model.md IndexMetadata: `IDX_VERSION_V2 = 0x02`, `IDX_HASH_TYPE_UNKNOWN = 0`, `IDX_HASH_TYPE_SHA1 = 1`, `IDX_HASH_TYPE_NTLM = 2`, and updated `IDX_HEADER_SIZE = 19`. Layout: byte 0 = sorted flag (unchanged `IDX_SORTED_FLAG_OK`), byte 1 = version marker, byte 2 = hash type, bytes 3–10 = mtime (BigInt64LE), bytes 11–18 = file size (BigUInt64LE). The sorted flag MUST remain at byte 0 so `detectSortedness.ts` needs no header-offset change. Also correct the misleading `HIBP_API_HASH_LENGTH` doc comment at src/constants.ts:93 (it is the 35-char suffix, not "5 prefix + 30 suffix") and prefer the new type-derived suffix-length helpers over that constant in split-dir/API call sites. Add JSDoc to all new exported constants.
- [X] T007 Implement `hashPassword(password, hashType)` in src/hashing/hashPassword.ts — sha1 via the existing built-in path (uppercase hex), ntlm as MD4 of the UTF-16LE password (uppercase hex) using the self-contained `src/crypto/md4.ts`. CONFIRMED on the Node 26 baseline: `crypto.getHashes()` excludes `md4` and `crypto.createHash('md4')` throws unsupported, so do NOT use `crypto`/`--openssl-legacy-provider` (forbidden by spec Assumptions + Constitution II) and do NOT add a third-party crypto dependency (Constitution dependency policy). Implement RFC 1320 MD4 in src/crypto/md4.ts with JSDoc (`@security`) and reference-vector tests; correctness pinned to the T002 vectors
- [X] T008 [P] Wire `HASH_TYPE` and `HASH_TYPE_MISMATCH` through config: defaults in src/envDefaults.ts, parsing via the existing `parseEnum` pattern in src/envLoader.ts, and validation in src/validateConfig.ts so invalid values produce a clear error naming valid options (FR-009)
- [X] T009 Implement content-based detection + effective hash-type resolution in src/hashing/detectHashType.ts — sample the first non-empty line (single file) or a non-empty prefix file's content (split dir), ignoring CRLF/LF and blank lines and never using file names (FR-012); explicit type overrides detection (assumptions); API mode with `auto` resolves to sha1 and records a user-notice requirement (FR-006); in `auto` mode a confident detection wins; when detection is `unknown`/`ambiguous` in `auto`, raise an explicit error rather than guess. Requested-vs-detected mismatch governance (error/warn modes) is US3 scope
- [X] T010 [P] Add shared NTLM test scaffolding: tests/helpers/ntlm.ts mirroring tests/helpers/sha1.ts, and fixtures under tests/fixtures/ (small NTLM single-file corpus, NTLM split-prefix directory, and a corresponding SHA-1 corpus) built around the quickstart.md reference vectors, reusable by US1–US3 tests

**Checkpoint**: Foundation ready — user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Check a vault against an NTLM corpus (Priority: P1) 🎯 MVP

**Goal**: Users select NTLM (or rely on `auto`) and scan a local NTLM corpus (single file or split-prefix directory); passwords are hashed with NTLM and matched with correct leak counts across all existing read modes, with outputs and summaries identifying the hash type. Backward-compatible defaults.

**Independent Test**: Feed a small NTLM-format corpus fixture with known hashes plus a vault fixture containing those passwords; run a scan and verify each planted password is reported with the correct leak count and that a hash existing only in an equivalent SHA-1 corpus produces no match. Fully testable on its own.

### Tests for User Story 1 (write FIRST, ensure they FAIL) ⚠️

- [X] T011 [P] [US1] Integration test in src/io/processSingleFile.integration.test.ts: explicit NTLM vs a single-file NTLM corpus fixture — every planted password reported with the correct count and hashes present only in the SHA-1 corpus produce zero matches (SC-001, US1 acceptance 1)
- [X] T012 [P] [US1] Integration test in tests/checkPasswordsLeaks.integration.test.ts: default run (no `HASH_TYPE`, i.e. `auto`) against the existing SHA-1 fixture corpora produces results identical to current behavior (SC-002, US1 acceptance 2)
- [X] T013 [P] [US1] Integration test in src/io/processSplitDirectory.integration.test.ts: NTLM split-prefix directory — all matching prefixes found, correct leak counts, suffix length 27 (FR-004, US1 acceptance 3)
- [X] T014 [P] [US1] Test `.idx` hash-type/size metadata: an index built for one hash type or a different file size (including a same-path mtime-preserving corpus swap) is detected as stale/mismatched and rebuilt, and a legacy (pre-metadata) index is invalidated — in src/io/processSingleFile.integration.test.ts and src/io/modeResolver.unit.test.ts (FR-008, edge cases: stale index, same-path swap, legacy index)
- [X] T015 [P] [US1] Edge-case tests in tests/: Unicode/non-ASCII password NTLM hashing is cross-platform-consistent (UTF-16LE), hex matching is case-insensitive (corpus uses lower-case hex), CRLF/LF/padded lines do not affect matching, and a password present in BOTH the SHA-1 and NTLM fixtures is matched only by the active run's type (edge cases)
- [X] T016 [US1] Test that CSV and JSON outputs carry a per-record hash-type field and that the console summary and dry-run summary state the active hash type and how it was chosen — in src/handlers/csv/csv.unit.test.ts, src/handlers/json/json.unit.test.ts, and tests/checkPasswordsLeaks.integration.test.ts (FR-010/FR-011)

### Implementation for User Story 1

- [X] T017 [US1] Use `hashPassword(password, effectiveHashType)` in the hashing step of src/checkPasswordsLeaks.ts (replace the hard-coded `crypto.hash('sha1', password, 'hex').toUpperCase()` at src/checkPasswordsLeaks.ts:322) so NTLM runs never derive SHA-1 and vice versa (FR-002)
- [X] T018 [US1] Parameterize lookup-map construction by active full-hash length in src/hashing/buildLookupMap.ts (replace hard-coded `hashBuf.subarray(0, 40)` at src/hashing/buildLookupMap.ts:29)
- [X] T019 [US1] Parameterize prefix grouping by active full-hash length in src/hashing/groupByPrefix.ts (replace hard-coded `fullHashBuf.subarray(0, 40)` at src/hashing/groupByPrefix.ts:36)
- [X] T020 [US1] Parameterize sortedness detection by hash type in src/hashing/detectSortedness.ts (replace SHA1_HEX_LENGTH uses at lines 35, 37–38, 58, 107, 143, 146 with the active full-hash length)
- [X] T021 [US1] Generalize `parseBuffer` in src/hashing/parseBuffer.ts — add an explicit `fullHashLength` parameter to the `parseBuffer` signature and to `ParseBufferOptions` (32 for NTLM, 40 for SHA-1; it is NOT derivable from `hashLength`), and replace the `skipBytes = 40 - hashLength` formula (src/hashing/parseBuffer.ts:104) with `fullHashLength - hashLength` so full-line NTLM matching uses skip 0 and suffix matching (split-dir/API) uses skip 5 in both types; update ALL callers to pass the active full-hash length (src/io/processChunk.ts, src/io/processSplitDirectory.ts, src/io/processHibpApi.ts)
- [X] T022 [US1] Parameterize the local single-file scan call sites in src/io/processChunk.ts (SHA1_HEX_LENGTH at lines 191, 225, 281) to pass the active full-hash length
- [X] T023 [US1] Thread the active full-hash length through the worker in src/io/processChunkWorker.ts (add to `workerData` and the `processChunk` invocation)
- [X] T024 [US1] Parameterize the binary search reader in src/io/readModes/binarySearch.ts (replace SHA1_HEX_LENGTH at lines 217, 237, 249 with the active full-hash length)
- [X] T025 [US1] Parameterize the index-based reader in src/io/readModes/indexBased.ts (replace SHA1_HEX_LENGTH at src/io/readModes/indexBased.ts:137 with the active full-hash length)
- [X] T026 [US1] Propagate active hash-info through single-file scanning: src/io/processDataLeaks.ts, src/io/processSingleFile.ts, src/io/readModes/sequential.ts, and src/io/readModeEvaluator.ts (line-length estimate) so all read modes — auto, sequential, binary, index — work for NTLM corpora (FR-003)
- [X] T027 [US1] Parameterize split-directory scanning in src/io/processSplitDirectory.ts to use the active suffix length (27 for NTLM) in the `parseBuffer` call at src/io/processSplitDirectory.ts:128 (FR-004)
- [X] T028 [US1] Extend the `.idx` header: create src/io/indexHeader.ts (encode/decode/validate sorted flag, version marker, hash type, mtime, file size per data-model.md); write the new header in src/io/readModes/sequential.ts (the single writer; `src/scripts/buildIndex.ts` reaches it via `runSequential`) keeping the sorted flag at byte 0 so `detectSortedness.ts` (`header[0] & IDX_SORTED_FLAG_OK`) is unaffected; validate version marker + hash type + file size (+mtime freshness) on load in src/io/modeResolver.ts (`loadIndex`/`tryLoadIndex`) and in the `READ_MODE_FORCED=index` path in src/io/processSingleFile.ts; treat legacy/wrong-size/absent-marker headers as stale and rebuild (FR-008, edge cases: stale index, same-path swap)
- [X] T029 [US1] Add the hash-type field per record in src/handlers/csv/write.ts (`login_password_hash_type` column added to `COLUMNS_ORDER`) and src/handlers/json/write.ts (`login_password_hash_type` property in the key-order arrays), reflecting the hash type actually used (FR-010)
- [X] T030 [US1] Show the active hash type and how it was chosen (explicit/detected) in the console summary and the dry-run summary in src/checkPasswordsLeaks.ts, resolving the effective type before printing (deterministic, bounded sampling only) (FR-011)

**Checkpoint**: User Story 1 fully functional and testable independently — NTLM offline MVP

---

## Phase 4: User Story 2 - Check via the HIBP API in NTLM mode (Priority: P2)

**Goal**: NTLM checking via the HIBP k-anonymity API. Only the 5-character hash prefix leaves the machine; NTLM suffix ranges (27 chars) are matched locally.

**Independent Test**: Stand up a stub/fixture API returning an NTLM suffix range containing a known password's hash; verify the password is reported with the correct count and non-matching passwords are reported safe. Verifiable on its own.

### Tests for User Story 2 (write FIRST, ensure they FAIL) ⚠️

- [X] T031 [P] [US2] Integration test in src/io/processHibpApi.integration.test.ts: stub API returns an NTLM (27-char suffix) range containing a known-vector hash; verify the leaked password gets the correct count and a non-matching password is reported safe (US2 acceptance 1), AND assert those counts are identical to the counts from the local NTLM corpus fixture for the same password set (SC-003)
- [X] T032 [P] [US2] Unit test in src/io/processHibpApi.unit.test.ts: in NTLM mode only the 5-character prefix is transmitted and NTLM suffixes are matched locally against 27-char suffix buffers (FR-005, US2 acceptance 2)
- [X] T033 [P] [US2] Unit test in src/io/processHibpApi.unit.test.ts / src/hashing/detectHashType.unit.test.ts: API mode with `auto` (default) resolves to sha1 and emits a notice to the user (FR-006)

### Implementation for User Story 2

- [X] T034 [US2] Thread the active hash type into src/io/processHibpApi.ts — use the active suffix length (27 for NTLM) in the `parseBuffer` call at src/io/processHibpApi.ts:218, keep `HASH_PREFIX_LENGTH` = 5 for requests, and update the call site in src/checkPasswordsLeaks.ts (API branch) to pass the effective hash info (FR-005)
- [X] T035 [US2] Emit the required user notice when API mode + `auto` resolves to sha1 (FR-006) and include the active hash type in the API mode log/summary lines in src/io/processHibpApi.ts and src/checkPasswordsLeaks.ts

**Checkpoint**: User Stories 1 AND 2 both work independently

---

## Phase 5: User Story 3 - Explicit, safe hash-type selection and auto-detection (Priority: P3)

**Goal**: Explicit or detected hash type can never silently produce an incorrect leak verdict. Invalid config fails before scanning; mismatches abort (default `error`) or self-correct (`warn`) with prominent visibility; ambiguous/unreadable corpora always abort.

**Independent Test**: Feed (a) an invalid hash-type value, (b) a SHA-1 corpus while NTLM is explicitly selected, and (c) an unreadable/empty directory; verify each fails with a clear, actionable message and never returns misleading results.

### Tests for User Story 3 (write FIRST, ensure they FAIL) ⚠️

- [X] T036 [P] [US3] Unit/integration tests in tests/checkPasswordsLeaks.error-paths.unit.test.ts and new src/hashing-specific tests: explicit NTLM vs confidently-detected SHA-1 corpus in `error` mode aborts before scanning naming requested and detected types; in `warn` mode emits a prominent warning, self-corrects, and produces results identical to a correctly-configured run (FR-007, SC-007, US3 acceptance 2)
- [X] T037 [P] [US3] Unit tests in src/hashing/detectHashType.unit.test.ts: empty/incomplete/unreadable corpus or split-prefix directory, ambiguous/mixed hash types within one corpus, and malformed lines whose hash-part length is neither the expected full nor suffix length cause explicit errors (no guessing, no silent skip) in both modes (FR-007, FR-012, edge cases: no readable data, mixed hash types, malformed lines)
- [X] T038 [P] [US3] Unit tests for self-correction visibility: in `warn` mode the effective type and the overridden requested type appear in the console summary and in outputs (spec edge case "Self-corrected run visibility", US3 acceptance 2) — in tests/checkPasswordsLeaks.integration.test.ts and handler unit tests

### Implementation for User Story 3

- [X] T039 [US3] Implement mismatch governance in the effective-hash-type resolution call site in src/checkPasswordsLeaks.ts: when an explicit requested type conflicts with a confidently detected corpus type, apply `hashTypeMismatch` — `error` (default) aborts before scanning with a message naming requested and detected types; `warn` emits a prominent warning and self-corrects the effective type so results remain correct (FR-007, FR-009)
- [X] T040 [US3] Harden detection confidence rules in src/hashing/detectHashType.ts: empty, incomplete, unreadable, or all-blank corpora/directories, and mixed/ambiguous hash types within a corpus are data-integrity errors that abort in both `error` and `warn` modes rather than guessing; auto-detection stays deterministic and content-based, never using file names (FR-007, FR-012, edge cases)
- [X] T041 [US3] Make self-correction visible end-to-end: record the corrected effective type in the run metadata and outputs (the per-record hash-type field from US1 already reflects the corrected type) and show the requested-vs-effective override in the console summary (FR-010, FR-011)
- [X] T042 [US3] Verify integration-level ordering: an invalid `HASH_TYPE`/`HASH_TYPE_MISMATCH` value or a mismatch in `error` mode fails before any reading, hashing, or scanning begins, with a message naming valid options (FR-009, SC-004)

**Checkpoint**: All user stories independently functional

---

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, remaining edge-case coverage, and validation gates that affect multiple user stories

- [X] T043 [P] Update documentation per FR-013: README.md (NTLM option, auto-detection behavior, mismatch modes, how to obtain NTLM corpora via the Pwned Passwords Downloader NTLM option), `.env.example` (`HASH_TYPE`, `HASH_TYPE_MISMATCH` with values and defaults), and CLI help in index.ts (new env vars)
- [X] T044 [P] Add/adjust cross-cutting tests: empty passwords remain filtered before hashing regardless of hash type; a bounded-memory test asserting NTLM single-file and split-dir scans never load the whole corpus (peak RSS / allocation bound, mirroring existing memory tests) (SC-006); and a fixture harness reproducing the quickstart.md scenarios (1–7) end-to-end in tests/
- [X] T045 Run the full validation gates per constitution Principle VII: `nvm use`, `npm run build:worker`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:coverage` — fix all errors, do not lower coverage thresholds, confirm the complete existing suite passes unchanged (SC-005)
- [X] T046 Final constitution review: verify SC-001–SC-007, backward compatibility (SC-002/SC-005), bounded memory for NTLM paths (SC-006, no full-corpus load, streaming preserved), no process-wide crypto weakening, no undeclared dependencies (AGENTS.md dependency policy), and that quickstart.md verification checklist items are satisfied

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational completion
  - Can proceed in parallel (if staffed) or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: After Foundational only. Same-file touchpoints with US2/US3: `src/checkPasswordsLeaks.ts` (hashing/summary/call sites) — US2 and US3 edit this file too, so they should follow US1 sequentially, not in parallel on the same file
- **User Story 2 (P2)**: After Foundational; integrates with US1's threading but independently testable with a stub API
- **User Story 3 (P3)**: After Foundational; builds on detection primitives from US1 but independently testable

### Within Each User Story

- Tests (included — spec mandates them) MUST be written and FAIL before implementation
- Types → constants → config → hashing → processing paths → outputs, then integration

### Parallel Opportunities

- T002/T003/T004 (foundational tests) can run in parallel
- T005/T006/T008/T010 (foundational impl) can run in parallel
- All US1 test tasks T011–T015 can run in parallel; T016 pairs with T029/T030
- All US2 tests T031–T033 can run in parallel
- All US3 tests T036–T038 can run in parallel
- T043/T044 (polish) can run in parallel

---

## Parallel Example: User Story 1

```text
# Launch all tests for User Story 1 together (TDD):
Task: T011 single-file NTLM integration test
Task: T012 backward-compat default SHA-1 test
Task: T013 split-prefix NTLM dir integration test
Task: T014 index hash-type/size metadata tests
Task: T015 edge-case (Unicode/case-insensitivity/CRLF) tests

# Then parallel implementation on disjoint files:
Task: T018 buildLookupMap.ts | T019 groupByPrefix.ts | T020 detectSortedness.ts
Task: T022 processChunk.ts | T024 binarySearch.ts | T025 indexBased.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (baseline)
2. Complete Phase 2: Foundational (types, constants, config, NTLM hashing, detection)
3. Complete Phase 3: User Story 1 (NTLM offline: single-file + split-dir + index + outputs)
4. **STOP and VALIDATE**: run US1 tests independently + full suite + coverage
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. User Story 1 → test independently → Demo (MVP!)
3. User Story 2 → test independently (stub API)
4. User Story 3 → test independently (mismatch/hardening)
5. Polish phase → docs + full validation gates

### Parallel Team Strategy

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (has primary ownership of src/checkPasswordsLeaks.ts)
   - Developer B: User Story 2 (waits for US1 call-site threading, then edits processHibpApi.ts)
   - Developer C: User Story 3 (waits for US1, then edits detectHashType.ts resolution + summary reporting)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to the user story for traceability
- Each user story is independently completable and testable
- Verify tests fail before implementing (TDD)
- Commit after each task or logical group
- Stop at any checkpoint to validate the story independently
- Deprecated/legacy `.idx` files are invalidated, never misapplied

---

## Phase 6: Convergence

- [X] T047 Add NTLM HIBP API tests (FR-005, US2/AC1, US2/AC2, SC-003, SC-005): integration test in src/io/processHibpApi.integration.test.ts where a stub returns a 27-char NTLM suffix range — a known-vector password gets the correct count, a non-matching password is reported safe, and counts equal the local NTLM corpus fixture; unit test in src/io/processHibpApi.unit.test.ts asserting only the 5-char prefix is transmitted and NTLM suffixes are matched locally (missing)
- [X] T048 Fix API+auto notice handling per FR-006/FR-011: write the notice to stderr and echo it in the console summary, and label the effective type accurately (not "detected") when `auto` resolves to SHA-1 in API mode in src/checkPasswordsLeaks.ts (partial)
- [X] T049 Add US3 error-path integration tests in tests/checkPasswordsLeaks.error-paths.unit.test.ts per FR-007, SC-004, SC-007, US3/AC2: explicit NTLM vs a confidently-detected SHA-1 corpus aborts before scanning naming requested and detected types in `error` mode; in `warn` mode emits the warning, self-corrects, and yields results identical to a correctly-configured run (partial)
- [X] T050 Update documentation per FR-013: README.md (HASH_TYPE, HASH_TYPE_MISMATCH, auto-detection behavior, mismatch modes, obtaining NTLM corpora via the Pwned Passwords Downloader NTLM option), .env.example (both vars with values and defaults), and index.ts --help env list (missing)
- [X] T051 Add self-correction visibility tests per FR-010/FR-011 and the "Self-corrected run visibility" edge case: `warn` mode exposes the effective type and the overridden requested type in the console summary and in per-record outputs (partial)
- [X] T052 Add cross-cutting coverage per SC-006 and T044: a bounded-memory test asserting NTLM single-file and split-dir scans never load the whole corpus (mirroring existing memory tests), plus a fixture harness reproducing the quickstart.md scenarios end-to-end in tests/ (missing)
- [X] T053 Run the full validation gates per Constitution VII and SC-005 (`nvm use`, `npm run build:worker`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:coverage`); fix all errors and do not lower coverage thresholds (missing)
- [X] T054 Final constitution review per Constitution I–VII and AGENTS.md: verify SC-001–SC-007, SHA-1 backward compatibility, bounded memory on NTLM paths (no full-corpus load), no process-wide crypto weakening, no undeclared dependencies, and quickstart.md checklist items (missing)
- [X] T055 [Security] Zero the UTF-8/UTF-16LE password buffer in `src/hashing/hashPassword.ts` after hashing in both branches (route SHA-1 through an owned `Buffer.from(password, 'utf8')` so it is zeroable), using `zeroBuffer()` from `src/memory/secureCleanup.ts`; update the `@security` JSDoc (Constitution II; AGENTS.md "clear sensitive buffers when practical")
- [X] T056 [Security] Zero internal password-derived copies (`padded` Buffer and `x` Uint32Array) in `src/crypto/md4.ts` via `try/finally`; the returned digest and the unmutated input invariant must be preserved; update the `@security` JSDoc
- [X] T057 [Test] Add buffer-zeroing regression tests: `src/hashing/hashPassword.unit.test.ts` (capture via `vi.spyOn(Buffer, 'from')`, assert the utf8/utf16le buffer is all-zero and the digest is unchanged for both branches) and `src/crypto/md4.unit.test.ts` (capture `padded` via `vi.spyOn(Buffer, 'alloc')`, assert all-zero; keep the input-not-mutated test)
- [X] T058 [Validation] Run `npm run build:worker`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:coverage`; fix all errors, do not lower coverage thresholds, and confirm all NTLM/SHA-1 vectors still pass

## Phase 7: Convergence

- [X] T059 [Bug] Honor the hash type in the standalone index builder per FR-008 (and plan touch-point `src/scripts/buildIndex.ts`, SC-005): `src/scripts/buildIndex.ts` calls `detectSortedness(filePath)` and `sequentialReader(...)` without `fullHashLength`, so an NTLM (32-char) corpus yields no `.idx` (lines are rejected at the SHA-1 length of 40, leaving `prefixBoundaries` empty) while the script still prints "Index built", and any index it did write would record header byte 2 as SHA-1 rather than NTLM; resolve the active hash type (from `HASH_TYPE` via `loadConfig` and/or content detection with `detectHashType`) and pass `fullHashLength` through to both `detectSortedness` and `sequentialReader`, and fail loudly (error message + non-zero exit, no "Index built") when no index is produced; add a regression test in `src/scripts/buildIndex.integration.test.ts` using a 32-char NTLM corpus asserting the `.idx` exists with header byte 2 = NTLM and that a SHA-1-length constant is not hardcoded (fix the stale `IDX_HEADER_SIZE = 9` in that test) per FR-008 (partial)