# Implementation Plan: Improved Sortedness Check

**Branch**: `002-improve-sortedness-check` | **Date**: 2026-10-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-improve-sortedness-check/spec.md`

## Summary

Replace the current nondeterministic sortedness check (`src/hashing/detectSortedness.ts`: head/tail windows + 20 `Math.random()` probes, no cross-region verification) with a deterministic, size-scaled strata sampler: corpora below 1 GiB skip the check entirely (tri-state verdict `skipped`, `.idx` invalidated, sequential read only); corpora at or above 1 GiB are verified via `N = clamp(ceil(F / 4 GiB), 20, 256)` evenly spaced region samples, each with intra-region adjacency checks plus cross-region anchor ordering, retaining the existing head/tail windows. The `.idx` header version bumps to V3 so caches stamped by the weaker algorithm are treated as stale, re-verified, and re-stamped. Constant bounded memory; at most ~1.06 MB (1,064,576 B) additional reads on an 89 GiB corpus.

## Technical Context

**Language/Version**: TypeScript on Node >= 26 (`engines`, `.nvmrc` = 26; `await using` explicit resource management in use)

**Primary Dependencies**: None added. Existing: Node `fs` positioned reads, vitest 4, eslint 10, typescript-eslint

**Storage**: HIBP hash corpus text files (`HASH:COUNT`, SHA-1/NTLM, LF/CRLF) plus sidecar `.idx` index (19-byte header + 8,388,624-byte prefix-offset table)

**Testing**: Vitest 4 with 90% coverage thresholds; `*.unit.test.ts` / `*.integration.test.ts` colocated with implementation; shared fixtures in `tests/fixtures/`

**Target Platform**: macOS/Linux CLI

**Project Type**: CLI tool

**Performance Goals**: Sortedness check adds < 1% to total scan runtime for corpora at or above 1 GiB (plan-level goal; see SC-004); at most 256 sampled regions

**Constraints**: Constant memory independent of corpus size (FR-005); no whole-corpus reads (FR-006); deterministic verdicts for identical input (FR-010); bounded additional reads

**Scale/Scope**: ~89 GiB corpora today, 5-10x growth assumed; ~10 source files touched, ~6 test files updated, 2 new test files

**Unknowns**: None — spec clarifications (Session 2026-10-15) resolved all ambiguities. No NEEDS CLARIFICATION items remain.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Verdict | Evidence |
|------|---------|----------|
| I. Correctness | PASS | Cross-region detection closes the block-reorder hole (SC-001); tri-state verdict is explicit; non-overlap invariant validated at runtime, not assumed (FR-012); existing local adjacency retained (FR-004); no new false rejections (FR-009) |
| II. Security | PASS | No secrets introduced; sampled hash values are never logged (log lines state verdict only); no new dependencies |
| III. Streaming & bounded memory | PASS | Max read: 2 × 8000 B head/tail + 256 × 4096 B regions = 1,064,576 B (~1.02 MiB), fixed-size buffers, positioned `fd.read` — independent of corpus size |
| IV. Reliability & determinism | PASS | Offsets derived purely from `fileSize`; `Math.random()` eliminated (fixes SC-003); I/O errors surface explicitly |
| V. Code quality | PASS | Named constants replace magic numbers; JSDoc on all exports; pure offset math extracted for testability |
| VI. Testing | PASS | Unit + integration plan in Phase 1; regression suite preserved; deterministic tests only |
| VII. Validation gates | PASS | `npm run lint`, `npm run typecheck`, `npm run test:coverage` before completion |

**Post-Design Re-Check (after Phase 1)**: PASS — design artifacts introduce no new violations; Complexity Tracking remains empty.

**Complexity Tracking**: no violations.

## Project Structure

### Documentation (this feature)

```text
specs/002-improve-sortedness-check/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── sortedness-contract.md
├── spec.md              # Feature specification
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── constants.ts                  # + SORTEDNESS_SAMPLE_STRATA_BYTES (4 GiB),
│                                 #   SORTEDNESS_MIN_REGIONS (20), SORTEDNESS_MAX_REGIONS (256),
│                                 #   SORTEDNESS_REGION_READ_BYTES (4096), IDX_VERSION_V3 (0x03);
│                                 #   - SORTEDNESS_CHECK_PAIRS
├── types.ts                      # + SortednessVerdict
├── hashing/
│   ├── detectSortedness.ts       # tri-state entry; V3 cache gate; threshold skip; orchestration
│   ├── sortednessSampling.ts     # NEW: pure offset math + region anchor sampling
│   ├── detectSortedness.unit.test.ts          # updated for tri-state / V3 / determinism
│   ├── sortednessSampling.unit.test.ts        # NEW
│   └── detectSortedness.integration.test.ts   # NEW: >=1 GiB generated corpora
├── io/
│   ├── modeResolver.ts           # detectSortednessAndCleanup -> tri-state; unlink on unsorted+skipped
│   ├── indexHeader.ts            # V3 encode/check
│   └── processSingleFile.ts      # verdict mapping; skipped -> sequential-only; forced-mode refusal
└── scripts/buildIndex.ts         # refuse on skipped
tests/fixtures/                   # existing fixtures reused; block-reorder cases generated in tmpdir
```

**Structure Decision**: single-project CLI layout unchanged (existing `src/` tree). All changes colocated with existing sortedness/index code: entry point stays in `src/hashing/detectSortedness.ts` (all call sites import from there), new deterministic sampling module is a sibling `src/hashing/sortednessSampling.ts`, constants live under the existing `// Sortedness check` section in `src/constants.ts`. No new top-level directories.

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified

No violations — table intentionally empty.
