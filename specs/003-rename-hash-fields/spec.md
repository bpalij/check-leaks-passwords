# Feature Specification: Algorithm-Named Hash Fields in Output

**Feature Branch**: `003-rename-hash-fields`

**Created**: 2026-10-18

**Status**: Draft

**Input**: User description: "rename all fields in output files that contain hash values, so that they contain corresponding algorithm name (sha1 or ntlm)"

## Clarifications

### Session 2026-10-18

- Q: Should the generated comparison reports under `manual-testing-sha1/reports/` and `manual-testing-ntlm/reports/` be regenerated with the new field names, or treated as historical artifacts that stay unchanged? → A: Exempt — treat `reports/*.md` as historical artifacts; update only living docs (README) and tooling scripts.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Algorithm-named hash fields in output files (Priority: P1)

When a leak check finishes, every field in the CSV or JSON output file that holds a password hash value is named after the algorithm that produced it: `login_password_sha1` (or `login_password_ntlm`) per record, and `hash_sha1` (or `hash_ntlm`) at the group level in JSON. By reading a field's name alone, I can tell which algorithm its hash came from.

**Why this priority**: This is the entire core of the request — without it the feature delivers no value. It is fully testable on its own, independent of any other story.

**Independent Test**: Run scans producing CSV and JSON output for one SHA-1 run and one NTLM run; verify every hash-value field name contains the corresponding algorithm token and still holds the hash value as before, with all other content unchanged.

**Acceptance Scenarios**:

1. **Given** a run against a SHA-1 corpus, **When** CSV output is written, **Then** the hash column is named `login_password_sha1` and contains the SHA-1 hash values, and no column named `login_password_hash` exists.
2. **Given** a run against a SHA-1 corpus, **When** JSON output is written, **Then** each group has a `hash_sha1` field and each password record has a `login_password_sha1` field, both containing the hash value.
3. **Given** a run against an NTLM corpus, **When** output is written in either format, **Then** the corresponding field names use the `ntlm` token: `login_password_ntlm` in both formats and `hash_ntlm` at JSON group level.
4. **Given** a warn-mode run whose requested type conflicts with the detected corpus type, **When** output is written, **Then** field names use the corrected (effective) algorithm, not the requested one.
5. **Given** any run, **When** its output is compared to a pre-change output for the same input and settings, **Then** the files differ only by the renamed fields — all other field names, values, ordering, and formatting are unchanged.

---

### User Story 2 - Removal of the redundant hash-type field (Priority: P2)

The separate `login_password_hash_type` field no longer appears in CSV or JSON output. Since the algorithm is now readable from the hash field names, the duplicate marker is not emitted anywhere, and documentation and shipped tooling no longer reference it.

**Why this priority**: Cleanup that follows directly from US1. Output remains usable (though redundant) if only US1 ships, so this is a separable slice.

**Independent Test**: Produce output in both formats and assert that no field named `login_password_hash_type` exists while the algorithm-carrying hash field names are present.

**Acceptance Scenarios**:

1. **Given** any completed run, **When** CSV or JSON output is inspected, **Then** no field named `login_password_hash_type` is present.
2. **Given** the removal, **When** user documentation and shipped output-parsing tooling are reviewed, **Then** no reference to any legacy field name (`login_password_hash`, the group-level `hash` hash field, `login_password_hash_type`) remains.

---

### Edge Cases

- **Self-corrected runs (warn mode)**: requested `sha1` but corpus detected `ntlm` (or vice versa) → every hash field name must use the effective (corrected) algorithm token, never the requested one (FR-004, SC-005).
- **API-mode auto default**: `auto` resolves to SHA-1 because API mode has no local corpus to sample → field names use `sha1` (FR-004, SC-005).
- **Mixed algorithm names within one file**: must never occur — a run has exactly one effective hash type, so all hash-value fields in a single output file share one algorithm token (FR-004).
- **JSON carries the hash in two places** (group level and per record): both must be renamed consistently; renaming only one location is incorrect output (FR-002).
- **Runs with no explicit algorithm selection**: follow the tool's default (SHA-1), so output uses the `sha1` field names (FR-004).
- **Existing consumers of legacy names**: external scripts that read `login_password_hash`, group-level `hash`, or `login_password_hash_type` will stop finding them — accepted as a clean break (Assumptions); the project's own tooling is updated in the same change (FR-008).
- **Column and key ordering**: renamed hash fields must retain their predecessors' positions, so output structure is otherwise stable across the change (FR-006).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: In CSV output, every field that contains a password hash value MUST be named with the active algorithm token appended: `login_password_sha1` for a SHA-1 run, `login_password_ntlm` for an NTLM run.
- **FR-002**: In JSON output, every field that contains a password hash value MUST be named with the active algorithm token: `login_password_sha1` / `login_password_ntlm` on each password record, and `hash_sha1` / `hash_ntlm` on each group.
- **FR-003**: Outputs MUST NOT emit a separate algorithm-name field (`login_password_hash_type` or any equivalent replacement); the algorithm is discoverable solely from the hash field names.
- **FR-004**: Hash field names MUST use the effective hash type of the run (explicitly selected, auto-detected, or self-corrected) and MUST be identical for every record within a single output file.
- **FR-005**: The rename MUST NOT change any other field's name, value, ordering, or formatting. Leak counts (raw, readable, compact), identification metadata, and hash value formatting (uppercase hex) MUST remain exactly as before; only the renamed fields and the removed field may differ from pre-change output.
- **FR-006**: Renamed hash fields MUST retain the position their predecessors held in CSV column order and JSON key order, so output structure is otherwise stable.
- **FR-007**: User-facing documentation MUST be updated to the new field names, with zero remaining references to `login_password_hash`, the group-level `hash` hash field, or `login_password_hash_type`.
- **FR-008**: Shipped project tooling that reads or compares output files MUST parse the new field names correctly, with no stale references to legacy names.

### Key Entities *(include if feature involves data)*

- **Hash-value field**: an output field whose value is a password hash — exactly one per password record, plus one per group in JSON. Its name embeds the run's algorithm token (`sha1` or `ntlm`), making it the sole carrier of both the hash value and the algorithm identity in output.
- **Effective hash type**: the algorithm actually used for a run — `sha1` or `ntlm` — chosen explicitly, auto-detected from the corpus, or self-corrected on mismatch (established by the NTLM hash-type feature). One value per run; it determines the token in every hash field name.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For any SHA-1 run, 100% of hash-value fields in both CSV and JSON outputs contain the token `sha1` in their name.
- **SC-002**: For any NTLM run, 100% of hash-value fields in both outputs contain the token `ntlm` in their name.
- **SC-003**: Zero fields named `login_password_hash`, `login_password_hash_type`, or group-level `hash` appear in any output file, CSV or JSON.
- **SC-004**: For identical input and settings, post-change output differs from pre-change output only in the renamed and removed fields — all remaining content is byte-identical.
- **SC-005**: In self-corrected runs and API-mode default runs, 100% of records use the field names of the effective algorithm, never the requested-but-overridden one.
- **SC-006**: Zero stale references to the legacy field names remain in user documentation and shipped output-parsing tooling.

## Assumptions

- **Clean break**: the tool is pre-release (version 0.0.0), so legacy field names are removed outright — no aliases, dual emission, or compatibility period.
- **One algorithm per run**: the NTLM hash-type feature guarantees a single effective hash type per run, so hash field names are constant within one output file; dual-hash reporting is out of scope.
- **Naming tokens are lowercase** (`sha1`, `ntlm`), matching the values previously written by `login_password_hash_type`.
- **Scope is output files only**: the console and dry-run summaries are not output files and keep their existing hash-type display; only CSV and JSON files are affected by this feature.
- **Documentation and tooling ship with the change**: user documentation (README field lists and examples) and shipped output-comparison tooling are part of this feature's deliverables so that no stale references remain (FR-007, FR-008).
- **Hash value content unchanged**: only names change — hash hex values keep their current casing and format.
- **Historical report artifacts are exempt**: generated comparison reports under `manual-testing-*/reports/` record pre-change runs and are not regenerated or rewritten; FR-007/SC-006 cover living user documentation (README) and shipped tooling scripts only.
