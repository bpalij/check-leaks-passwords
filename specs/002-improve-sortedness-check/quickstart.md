# Quickstart: Validating the Improved Sortedness Check

**Feature**: `specs/002-improve-sortedness-check/spec.md` | **Date**: 2026-10-15

Run guide for validating the feature end-to-end. It references
[contracts/sortedness-contract.md](./contracts/sortedness-contract.md) and
[data-model.md](./data-model.md) instead of duplicating them; implementation
detail belongs to `tasks.md` (Phase 2).

## Prerequisites

- Node.js 26 per `.nvmrc` (`nvm use` if available); verify `node -v` satisfies
  `package.json` `engines` (Constitution VII).
- Dependencies installed: `npm ci`.
- No network access required; no real HIBP download needed (tests generate
  their own corpora).

## 1. Baseline validation gates (run before and after implementation)

```bash
npm run lint
npm run typecheck
npm run test:coverage
```

Expected: zero errors, coverage ≥ 90% statements/branches/functions/lines
(`vitest.config.ts` thresholds — do not lower them).

## 2. Targeted suites

```bash
npx vitest run src/hashing/detectSortedness.unit.test.ts src/hashing/sortednessSampling.unit.test.ts
npx vitest run src/io/modeResolver.unit.test.ts src/io/processSingleFile.unit.test.ts src/io/indexHeader.unit.test.ts
npx vitest run src/hashing/detectSortedness.integration.test.ts
npx vitest run src/scripts/buildIndex.integration.test.ts src/io/processSingleFile.integration.test.ts
```

Expected outcomes:

| Scenario | Expected |
|---|---|
| Deterministic offsets (`computeSampleOffsets`) | identical output for repeated calls; N clamps: 1 GiB → 20, ~80 GiB → 20, ≥ 1 TiB → 256 |
| Block-reordered corpus (≥ 1 GiB, two sorted halves reversed) | verdict `unsorted` (SC-001) |
| Strictly sorted corpus (≥ 1 GiB) | verdict `sorted` (SC-006) |
| Same corpus checked repeatedly | identical verdict every run (SC-003) |
| Corpus < 1 GiB (e.g. `tests/fixtures/small-sorted-hashes.txt`) | verdict `skipped`, `.idx` removed, neutral skip log — no "not sorted" claim (FR-011/FR-014) |
| V2-stamped `.idx` header with sorted flag set | treated as stale → live re-verification → re-stamped V3 (FR-008) |
| Fresh V3 `.idx` with flag set | cache hit returns `sorted` without corpus reads |
| Non-overlap invariant | explicit `Error` when `fileSize < N * max(4096, MAX_LINE_BYTES)` (unit test with synthetic sizes) |
| CRLF / short lines / duplicates / empty file | behavior unchanged vs baseline (regression) |

## 3. CLI end-to-end scenarios

```bash
# a) Sorted corpus: builds .idx with V3 header (byte 1 == 0x03)
npm run build-index -- <path-to-sorted-corpus>

# b) Unsorted corpus: refuses, exit 1, ".idx" absent afterwards
npm run build-index -- <path-to-unsorted-corpus> ; echo "exit=$?"

# c) Small corpus (< 1 GiB): refuses with "sortedness not verified" message, exit 1
npm run build-index -- tests/fixtures/sorted-hashes.txt ; echo "exit=$?"

# d) Forced order-dependent mode on a small corpus: must throw a refusal
#    naming "not verified (file below 1 GiB)", not "not sorted"
READ_MODE_FORCED=binary npm start -- <small-corpus> 2>&1 | grep -i sorted

# e) Full scan on a large corpus: check adds < 1% runtime,
#    log shows "File sorted: yes" (or the skip line for small corpora)
npm start -- <path-to-corpus>
```

Expected: (a) `.idx` byte 1 = `0x03`; (b)(c) exit code 1 with clear stderr;
(d) refusal error distinct from the unsorted message; (e) bounded additional
read — observe with `fs`/OS tools if desired: ≤ 1,064,576 B (~1.02 MiB) extra vs baseline.

## 4. Contract conformance spot-checks

- **Cache staleness**: run once to produce `.idx`, set its header byte 1 to
  `0x02`, run again → log shows a fresh verification (not a cached pass), then
  byte 1 is rewritten to `0x03`.
- **Determinism**: run scenario 3(e) twice on the same unchanged file; verdict
  line identical both times.
- **Neutral skip log**: scenario 3(c)'s scan counterpart (small corpus) must log
  the `skipped` line from contract §2 — grep must not match `not sorted`.

## 5. Out of scope for validation

- Cryptographic/forged-corpus resistance (spec Assumptions: out of scope).
- Inversions confined between two sampled regions (accepted residual limitation,
  spec Assumptions) — do not assert these in tests.
