# Implementation Plan: Algorithm-Named Hash Fields in Output

**Branch**: `003-rename-hash-fields` | **Date**: 2026-10-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-rename-hash-fields/spec.md`

## Summary

Rename every hash-value field in CSV/JSON output so the field name embeds the run's effective algorithm: `login_password_hash` → `login_password_sha1`/`login_password_ntlm` (both formats), group-level JSON `hash` → `hash_sha1`/`hash_ntlm`, and remove `login_password_hash_type` entirely. The rename keys off the single injection point already present — `OutputHandlerOptions.hashType`, fed from `activeHashInfo.type` at `src/checkPasswordsLeaks.ts:468` — so warn-mode self-correction, API-mode `auto`→sha1, and detection all flow through automatically (FR-004). Key/column order constants become hash-type-parameterized functions to satisfy position retention (FR-006); README and the three shipped comparison scripts are updated in the same change (FR-007/FR-008); `manual-testing-*/reports/*.md` are exempt per clarification.

## Technical Context

**Language/Version**: TypeScript on Node >= 26 (`engines`, `.nvmrc` = 26)

**Primary Dependencies**: None added. Existing: `fast-csv`, vitest 4, eslint 10, typescript-eslint

**Storage**: N/A — in-memory row construction; output written to CSV/JSON files (the artifacts this feature renames)

**Testing**: Vitest 4 with 90% coverage thresholds; `*.unit.test.ts` / `*.integration.test.ts` colocated; shared tests in `tests/`

**Target Platform**: macOS/Linux CLI

**Project Type**: CLI tool

**Performance Goals**: No measurable runtime change — field-name computation is O(1) per row against existing row loops

**Constraints**: Output structure otherwise byte-stable vs pre-change (FR-005/SC-004); exactly one algorithm token per output file (FR-004); no mixed names within a file

**Scale/Scope**: ~4 source files changed (`csv/write.ts`, `json/write.ts`, `types.ts`, plus JSDoc), ~5 test files updated, 3 tooling scripts, README; no schema/DB/network surface

**Unknowns**: None — spec clarifications (Session 2026-10-18) resolved all ambiguities. No NEEDS CLARIFICATION items remain.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Verdict | Evidence |
|------|---------|----------|
| I. Correctness | PASS | Field names derive from `activeHashInfo.type` — the same value used for hashing/matching, so names can't diverge from content (FR-004); effective-type propagation (corrected/api-default) covered by existing tests re-pointed to new names; explicit absence assertions for legacy names (SC-003) |
| II. Security | PASS | No new secret exposure: hash values already written to output; rename changes names only; no logging of new material; `stripSensitiveFields` interaction unchanged; no new dependencies |
| III. Streaming & bounded memory | PASS | Writers already materialize all rows for `fast-csv`/`JSON.stringify` (pre-existing, unchanged); rename adds only string-key computation, no new buffering |
| IV. Reliability & determinism | PASS | Field names are a pure function of the run's effective hash type — identical inputs produce identical names; no randomness, no environment dependence |
| V. Code quality | PASS | Name construction centralized (no magic strings scattered); JSDoc updated on `OutputHandlerOptions.hashType` (`src/types.ts:151-152` currently documents the removed field) and on `writeJsonOutputFile` (`src/handlers/json/write.ts:135-136`, which currently names `login_password_hash`); T024 sweeps `src/` for stale field names; order constants become named, documented functions |
| VI. Testing | PASS | Unit (writers) + integration (end-to-end sha1/ntlm/corrected runs) updated; new assertions: legacy-name absence, position retention, single-token-per-file invariant |
| VII. Validation gates | PASS | `npm run lint`, `npm run typecheck`, `npm run test:coverage` before completion |

**Post-Design Re-Check (after Phase 1)**: PASS — design artifacts introduce no new violations; Complexity Tracking remains empty.

**Complexity Tracking**: no violations.

## Project Structure

### Documentation (this feature)

```text
specs/003-rename-hash-fields/
├── plan.md              # This file (/speckit.plan output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── output-fields-contract.md
├── spec.md              # Feature specification
├── checklists/
│   └── requirements.md  # already present
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── types.ts                      # OutputHandlerOptions.hashType JSDoc rewrite
│                                 #   (hashType now names the field, not a per-record column)
├── handlers/
│   ├── csv/write.ts              # COLUMNS_ORDER -> buildCsvColumnOrder(hashType);
│                                 #   row enrichment emits login_password_<alg> only
│   ├── json/write.ts             # JSON_KEY_ORDER_NESTED/FLAT -> buildJsonKeyOrder*(hashType);
│                                 #   record field renamed; group spread changed from
│                                 #   {...group} to explicit {hash_<alg>, leaks, passwordObjects}
│   ├── csv/csv.unit.test.ts      # header/order assertions -> new names; legacy absence
│   └── json/json.unit.test.ts    # record + group-level key assertions -> new names
tests/
├── checkPasswordsLeaks.integration.test.ts  # login_password_hash* / group .hash / hash_type -> new names
└── ntlm-quickstart.integration.test.ts      # hash_type assertions -> field-name token assertions
manual-testing-sha1/scripts/
└── compare-outputs.mjs            # normalize(): read login_password_<alg>, hash_<alg>
manual-testing-ntlm/scripts/
├── compare-outputs.mjs            # same
└── compare-cross-plan.mjs         # same
README.md                          # L77 (hash_type mention), L244 (field list)
```

**Structure Decision**: single-project CLI layout unchanged. All changes land in the two existing writers (`src/handlers/csv/write.ts`, `src/handlers/json/write.ts`) where the fields are emitted — no new modules, no new directories. The internal representation (`HashWithLeaksAndPasswordObjects.hash`, `enrichResults.ts`, `ActiveHashInfo`) is untouched: only the *output serialization* renames keys.

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified

No violations — table intentionally empty.
