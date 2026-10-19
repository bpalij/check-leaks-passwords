# Quickstart: Validating the Rename

**Feature**: `specs/003-rename-hash-fields/spec.md` | **Date**: 2026-10-18

Run guide for validating the feature end-to-end. It references
[contracts/output-fields-contract.md](./contracts/output-fields-contract.md)
and [data-model.md](./data-model.md) instead of duplicating them; implementation
detail belongs in `tasks.md` (Phase 2).

## Prerequisites

- Node.js 26 per `.nvmrc` (`nvm use` if available); verify `node -v` satisfies
  `package.json` `engines` (Constitution VII).
- Dependencies installed: `npm ci`.
- Baseline capture **before implementing** (needed for §4): run one sha1 scan
  and one ntlm scan against test fixtures, keep the output files as `pre-*`
  references.

## 1. Validation gates (run before and after implementation)

```bash
npm run lint
npm run typecheck
npm run test:coverage
```

Expected: zero errors, coverage ≥ 90% statements/branches/functions/lines
(`vitest.config.ts` thresholds — do not lower them).

## 2. Targeted suites

```bash
npx vitest run src/handlers/csv/csv.unit.test.ts src/handlers/json/json.unit.test.ts
npx vitest run tests/checkPasswordsLeaks.integration.test.ts tests/ntlm-quickstart.integration.test.ts
```

Expected outcomes (mapped to acceptance scenarios):

| Scenario | Expected |
|---|---|
| sha1 run, CSV | header contains `login_password_sha1` at the old column's position; no `login_password_hash`/`login_password_hash_type` (SC-001/SC-003, SC-004 position) |
| sha1 run, JSON | records have `login_password_sha1`, groups have `hash_sha1` as first key (SC-001) |
| ntlm run, both formats | token `ntlm` everywhere (SC-002) |
| warn-mode corrected run (request sha1, ntlm corpus) | field names use `ntlm` (SC-005) |
| API-mode `auto` | `sha1` names (SC-005) |
| whole-file token scan | exactly one distinct algorithm token per file (FR-004 edge case: no mixed names) |
| post vs pre output diff | differs only in renamed/removed fields; all else byte-identical (SC-004) |

## 3. CLI end-to-end

```bash
npm run build
node dist/index.js   # sha1 run: OUTPUT_0_FORMAT=csv + OUTPUT_1_FORMAT=json
head -1 <out.csv>    # contains login_password_sha1, not login_password_hash/hash_type
grep -o 'hash_sha1' <out.json> | head -1
node dist/index.js   # ntlm run: HASH_TYPE=ntlm
head -1 <out.csv>    # login_password_ntlm
```

Expected: field names match the run's effective type; group-level
`hash_sha1`/`hash_ntlm` present; legacy names absent
(`grep -E 'login_password_hash(_type)?|"hash"' <out>` → no matches).

## 4. Contract conformance spot-checks

- **Byte-stability**: `diff pre-<sha1>.csv <sha1>.csv` — only the renamed
  column and dropped `hash_type` column differ; same for JSON with only key
  names changed.
- **Tooling**: `node manual-testing-ntlm/scripts/compare-outputs.mjs` (and the
  other two scripts) run without errors on freshly generated outputs; no
  `login_password_hash` string remains:
  `grep -rn 'login_password_hash' manual-testing-*/scripts/` → empty.
- **Docs**: `grep -rn 'login_password_hash\|login_password_hash_type' README.md`
  → empty.
- **Reports untouched**: `git status manual-testing-*/reports/` shows no
  modifications (exempt).

## 5. Out of scope for validation

- Regenerating `manual-testing-*/output/*` fixtures or reports
  (untracked/exempt).
- Console and dry-run hash-type display (spec Assumption: unchanged).
- Backward compatibility for external consumers (clean break).
