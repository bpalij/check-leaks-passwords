# Data Model: Algorithm-Named Hash Fields

**Feature**: `specs/003-rename-hash-fields/spec.md` | **Date**: 2026-10-18

Phase 1 output. Entities are extracted from the feature spec's Requirements and
Key Entities sections; validation rules cite the originating FR/SC.

## Entities

### `EffectiveHashType` (existing, re-roled)

The run's effective algorithm — now the *sole determinant* of hash-field
naming. Internal representation is the existing `ActiveHashInfo`
(`src/types.ts:223-242`); only its *output-serialization* role changes.

| Field | Type | Values |
|---|---|---|
| type | union literal | `'sha1' \| 'ntlm'` |
| source | union literal | `'explicit' \| 'detected' \| 'corrected' \| 'api-default'` (existing `ActiveHashInfo.source`) |

**Validation rules**

- Exactly one value per run; identical for every record in a single output file
  (FR-004).
- Reaches writers solely as `OutputHandlerOptions.hashType`; writers default to
  `'sha1'` when omitted (FR-004 "no explicit selection").
- `auto` never reaches a writer (resolved before hashing,
  `src/checkPasswordsLeaks.ts:332-363`).

### `RecordHashField` (output record field)

The per-password hash field in CSV columns / JSON record keys.

| Property | Value |
|---|---|
| Name (SHA-1 run) | `login_password_sha1` |
| Name (NTLM run) | `login_password_ntlm` |
| Value | hash hex, uppercase, unchanged from before (40 hex sha1 / 32 hex ntlm) |
| Cardinality | exactly one per password record (spec Key Entities) |
| Position | index previously held by `login_password_hash` in `COLUMNS_ORDER` / `JSON_KEY_ORDER_*` (FR-006) |

**Validation rules**

- Name suffix equals the run's effective type token (lowercase `sha1`/`ntlm`)
  (FR-001/FR-002, Assumptions).
- Exactly one of `login_password_sha1`/`login_password_ntlm` present per file;
  never both, never neither (FR-004, SC-001/SC-002).
- `login_password_hash` and `login_password_hash_type` must not exist anywhere
  (SC-003).

### `GroupHashField` (JSON group-level field)

| Property | Value |
|---|---|
| Name (SHA-1 run) | `hash_sha1` |
| Name (NTLM run) | `hash_ntlm` |
| Value | same hash hex as the group's records' `RecordHashField` |
| Cardinality | one per group; JSON only (CSV has no group level) |
| Position | first key of the group object — predecessor's position (FR-006) |

**Validation rules**

- Same token as every `RecordHashField` in the same file (FR-004/FR-002
  "renamed consistently").
- Group key order otherwise unchanged: `<hash field>`, `leaks`,
  `passwordObjects`.
- Legacy key `hash` must not appear at group level (SC-003).

### Removed field: `login_password_hash_type`

| Was | Now |
|---|---|
| CSV column + JSON record key holding `'sha1' \| 'ntlm'` | **not emitted** — algorithm discoverable only from hash field names (FR-003) |

**Validation rules**

- Absent from CSV headers and JSON record/group keys in every run mode
  (SC-003).
- No equivalent replacement field may be introduced (FR-003).

## Field-name determination (derivation rules)

```text
hashType = options.hashType ?? 'sha1'                    (per write call)
record key  = `login_password_${hashType}`               (CSV column + JSON record)
group key   = `hash_${hashType}`                         (JSON group only)
order arrays = build*Order(hashType) with the record key spliced at
               login_password_hash's former index and no hash_type entry
```

## Relationships

```text
Run (1) ──has──► EffectiveHashType (1)
EffectiveHashType (1) ──names──► RecordHashField (M, one per record, same token)
EffectiveHashType (1) ──names──► GroupHashField (M, JSON groups, same token)
GroupHashField (1) ──equals value of──► member RecordHashFields' values
OutputFile (1) ──contains exactly one algorithm token across all hash fields (FR-004)
```
