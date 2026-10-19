# Research: Algorithm-Named Hash Fields

**Feature**: `specs/003-rename-hash-fields/spec.md` | **Date**: 2026-10-18

Phase 0 research. All unknowns extracted from the Technical Context were resolved
by the spec's Session 2026-10-18 clarification and codebase inspection; this
document records the design decisions derived from them, the rationale, and the
alternatives considered.

## Current-state findings (baseline)

- **Single injection point**: both writers already receive `options.hashType`
  (`'sha1' | 'ntlm'`, default `'sha1'`), passed once at
  `src/checkPasswordsLeaks.ts:468` as `hashType: activeHashInfo.type`.
  `activeHashInfo.type` is the *effective* type — explicit, detected, corrected
  (warn mode), or api-default — so no new plumbing is needed (FR-004 falls out
  for free).
- **Emission sites**:
  - CSV: `src/handlers/csv/write.ts:148-149` sets `login_password_hash` /
    `login_password_hash_type` per row; `COLUMNS_ORDER` (L9-31) pins positions
    at L17-18.
  - JSON records: `src/handlers/json/write.ts:161-162`; positions in
    `JSON_KEY_ORDER_NESTED` (L14-15) and `JSON_KEY_ORDER_FLAT` (L50-51).
  - JSON group level: the group's `hash` reaches the file via the `...group`
    spread at `src/handlers/json/write.ts:155-156` — there is no explicit
    `hash:` write today; the key must be destructured to be renamed.
- **Order semantics**: `determineActiveColumns` (CSV) and `sortObjectKeys`
  (JSON) place known keys by the order array, then append unknown keys
  alphabetically. Therefore the *renamed* key must be present in the order
  arrays at its predecessor's index, or it would drift to the alphabetical tail
  (violating FR-006).
- **Consumers of legacy names**: 3 shipped scripts
  (`manual-testing-{sha1,ntlm}/scripts/compare-outputs.mjs`,
  `manual-testing-ntlm/scripts/compare-cross-plan.mjs`) read
  `obj.login_password_hash ?? group.hash` and `obj.login_password_hash_type`;
  README L77, L244; unit tests in both writers; 2 integration test files.
  `manual-testing-*/output/` and `manual-testing-*/reports/` are untracked
  (`git check-ignore` = ignored) and reports are exempt per clarification.
- **What is *not* affected**: console output (`describeHashType`), dry-run
  summary, `.idx` headers, HIBP API code, `enrichResults` internal shape —
  spec Assumption: scope is output files only.

## Decisions

### D1 — Derive names from `OutputHandlerOptions.hashType`

**Decision**: Field names are computed as `` `login_password_${hashType}` `` and
`` `hash_${hashType}` `` inside the writers, from the existing
`options.hashType ?? 'sha1'`.

**Rationale**: `activeHashInfo.type` is already the effective, self-corrected
value used for hashing itself; keying names off it makes FR-004
(corrected/api-default runs) structurally true rather than separately
reimplemented. Defaulting to `'sha1'` preserves current behavior for direct
writer callers (FR-004 "no explicit selection" edge case).

**Alternatives considered**: passing pre-computed field names from
`checkPasswordsLeaks.ts` — rejected, widens the options surface for no gain and
lets callers disagree with the hash type they pass; deriving from corpus
detection inside writers — rejected, writers have no corpus access and would
break API mode.

### D2 — Order constants become hash-type-parameterized functions

**Decision**: `COLUMNS_ORDER`, `JSON_KEY_ORDER_NESTED`, `JSON_KEY_ORDER_FLAT`
become functions (e.g. `buildCsvColumnOrder(hashType)`) that splice
`login_password_${hashType}` at the old `login_password_hash` index and *omit*
the `login_password_hash_type` entry entirely. Arrays are computed per write
call (they are ~20 strings, once per file — negligible).

**Rationale**: FR-006 requires the renamed field to hold its predecessor's
position; since the name varies per run, a static array cannot hold it.
Omitting `hash_type` in the order function guarantees it can never reappear via
the "unknown keys appended alphabetically" path (FR-003/SC-003 defense in
depth).

**Alternatives considered**: static arrays containing a placeholder token
replaced at write time — rejected, two-step substitution is easier to get wrong
than direct construction; keeping static legacy arrays and mapping after sort —
rejected, keys absent from the order array get appended alphabetically,
silently violating position retention.

### D3 — JSON group level: destructure instead of spread

**Decision**: Replace `...group` at `src/handlers/json/write.ts:155-156` with
an explicit object literal
`{ [`hash_${hashType}`]: group.hash, leaks: group.leaks, passwordObjects: ... }`,
enumerating the group's three keys in their current order
(`hash`, `leaks`, `passwordObjects`).

**Rationale**: The spread currently emits `hash` implicitly; renaming requires
touching it anyway, and an explicit literal (a) renames and (b) pins the
group-level key order by construction, satisfying FR-006 for the group level
where no order array exists. It also makes SC-003's "no group-level `hash`"
locally auditable — the literal is the only place group keys are written.

**Alternatives considered**: post-processing
`{...group, [`hash_${t}`]: group.hash}` then deleting `hash` — rejected,
transiently holds both keys and relies on delete-after-spread ordering;
renaming in `enrichResults.ts` (internal model) — rejected, spec scopes the
change to output files; internal `hash` is consumed by scan/sort/tooling and
renaming it would cascade (violates "avoid unrelated changes").

### D4 — Remove `login_password_hash_type` at emission, keep `hashType` option

**Decision**: Delete the `login_password_hash_type` assignments in both writers
and its entries from both order arrays; keep `OutputHandlerOptions.hashType`
(it now *only* drives field naming). Rewrite its JSDoc at `src/types.ts:147-159`.

**Rationale**: FR-003 forbids any equivalent replacement field; the option is
still required as the naming input (D1). The JSDoc currently promises the
removed column — stale docs violate Principle V.

**Alternatives considered**: dropping the option and passing `ActiveHashInfo` —
rejected, widens coupling for no behavioral change; a `fieldName` option
replacing `hashType` — rejected, callers would then compute names (see D1).

### D5 — Tooling scripts: read both new locations, infer token from presence

**Decision**: In the three compare scripts, `normalize()` becomes:
`hash = obj.login_password_sha1 ?? obj.login_password_ntlm ?? group.hash_sha1 ?? group.hash_ntlm ?? ''`
and
`hashType = 'login_password_ntlm' in obj || 'hash_ntlm' in group ? 'ntlm' : 'sha1'`
(exactly one of the fields must exist per the D6 invariant; scripts may flag
both-present as a finding). The `r.hashType` downstream assertions (32/40-hex
checks) keep working unchanged.

**Rationale**: FR-008 requires tooling to parse new names with no stale legacy
references; inferring the token from *which field exists* also validates the
single-algorithm invariant (FR-004) in the tooling layer for free.

**Alternatives considered**: reading hash type from the filename token —
rejected, filename encoding is a test-harness convention, not a property of
file content; keeping a fallback to `login_password_hash` — rejected, SC-006
forbids stale references in shipped tooling (these scripts are shipped).

### D6 — Single-token-per-file invariant is structural, plus explicit tests

**Decision**: One `hashType` value per write call already guarantees one token
per file (writers never branch per row/group). Tests assert it directly: for
each produced file, scan all header/key names and require the set of
`login_password_{sha1,ntlm}` / `hash_{sha1,ntlm}` occurrences to contain
exactly one distinct algorithm token, and assert `login_password_hash`,
`login_password_hash_type`, and group-level `hash` are absent (SC-003).

**Rationale**: Spec calls mixed names "incorrect output" (edge case); a
whole-file assertion catches order-array/emission mismatches that per-field
assertions miss.

**Alternatives considered**: relying on per-field assertions alone — rejected,
they don't detect e.g. `login_password_sha1` alongside `hash_ntlm`.

### D7 — Scope boundaries (what is deliberately untouched)

**Decision**: No changes to: internal `HashWithLeaksAndPasswordObjects.hash`
type or `enrichResults.ts`; console/`describeHashType`/dry-run text; `.idx`
header format; `manual-testing-*/reports/*.md` (clarification-exempt);
generated `manual-testing-*/output/*` files (untracked, regenerable — stale
ones simply lack the new fields until the manual suites are re-run; scripts
must not special-case them, D5); historical spec docs
(`specs/001-ntlm-hash-support/tasks.md:83`) — FR-007 covers *user*
documentation (README), and the clarification limits scope to "living docs
(README) and tooling scripts".

**Rationale**: Spec Assumptions explicitly scope output files only and exempt
reports; touching internals would violate "avoid unrelated changes".

**Alternatives considered**: regenerating `manual-testing-*/output/` as part of
the change — rejected, they're untracked artifacts produced by
`run-manual-tests.mjs`, not source; rewriting specs/001 history — rejected,
specs are immutable records of past decisions.

## Resolved unknowns summary

| Unknown (Technical Context) | Resolution |
|---|---|
| Where field names get the algorithm | D1: `options.hashType` at the two writers (already fed effective type) |
| How to keep renamed fields in position | D2: order arrays → per-hashType builder functions; group level pinned by explicit literal (D3) |
| Group-level `hash` rename mechanism | D3: destructure spread into explicit key literal |
| `hash_type` removal scope | D4: emission + order entries + JSDoc; option retained as naming input |
| Tooling parsing strategy | D5: presence-based dual-read, no legacy fallback |
| Mixed-token guarantee | D6: structural (one value per call) + whole-file tests |
| Stale artifacts / old docs | D7: output/ untracked-regenerable, reports exempt, README is the only user doc |
