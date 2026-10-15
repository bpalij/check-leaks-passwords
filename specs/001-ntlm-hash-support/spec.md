# Feature Specification: NTLM Hash Support

**Feature Branch**: `001-ntlm-hash-support`

**Created**: 2026-10-13

**Status**: Draft

**Input**: User description: "Investigate hash downloader in github, there is support for ntlm hashes, lets add support of it in this project"

## Clarifications

### Session 2026-10-13

- Q: On a hash-type/corpus mismatch, should the tool abort or continue? → A: Two configurable modes — `error` (default, abort) and `warn` (warn and self-correct to the detected type); ambiguous or unreadable detection aborts in both modes.
- Q: How should a `.idx` index behave when built for a different hash type? → A: The index header records the hash type (and file size); a mismatched index is auto-invalidated and rebuilt, and legacy indexes without the marker are treated as stale.
- Q: Should the active hash type appear in the output files? → A: Yes — emitted per record (a CSV column and a JSON property) and also shown in the console summary.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Check a vault against an NTLM corpus (Priority: P1)

A user who has downloaded the NTLM pwned-passwords corpus (for example with the
official Pwned Passwords Downloader's NTLM option) selects NTLM as the hash
type, points the tool at the local corpus (single file or split-prefix
directory), and receives leak counts for their vault passwords. Passwords are
hashed with NTLM for the lookup, exactly as they are hashed with SHA-1 today in
SHA-1 mode.

**Why this priority**: This is the core value of the feature — offline NTLM
checking at parity with the existing SHA-1 capability, for users who work with
Windows/Active Directory style hash corpora.

**Independent Test**: Provide a small NTLM-format corpus fixture containing
known NTLM hashes plus a vault fixture with those passwords; run a scan and
verify each planted password is reported with the correct leak count. Fully
testable on its own and delivers the primary value.

**Acceptance Scenarios**:

1. **Given** the hash type is set to NTLM and a local NTLM corpus, **When** the
   user runs a scan, **Then** every password is hashed as NTLM and matched
   against the corpus, with correct leak counts and no SHA-1-derived subjects.
2. **Given** the same input with no hash type configured (default), **When** the
   user runs a scan against an SHA-1 corpus, **Then** results are identical to
   the current behavior.
3. **Given** a split-prefix directory containing NTLM hashes, **When** the user
   runs a scan, **Then** all matching prefixes are found and leak counts are
   correct.

---

### User Story 2 - Check via the HIBP API in NTLM mode (Priority: P2)

A user sets the tool to query the HIBP k-anonymity API and selects NTLM; the
tool requests NTLM hash ranges (returning NTLM suffixes) and matches them
locally, so only the 5-character prefix of each NTLM hash leaves the machine.

**Why this priority**: Enables NTLM checking without downloading the full local
corpus, reusing the existing privacy-preserving API flow. Secondary to the
offline path because it requires network access.

**Independent Test**: Stand up a stub or fixture API that returns an NTLM suffix
range containing a known password's hash; verify the password is reported with
the correct count and that non-matching passwords are reported safe.

**Acceptance Scenarios**:

1. **Given** NTLM and API mode, **When** a breached password is checked, **Then**
   the reported leak count matches the result from a local NTLM corpus for the
   same password.
2. **Given** NTLM and API mode, **When** requests are made, **Then** only the
   5-character hash prefix is transmitted and the full hash/password never
   leaves the machine.

---

### User Story 3 - Explicit, safe hash-type selection and auto-detection (Priority: P3)

A user can select the hash type explicitly, or let the tool detect it from a
local corpus, and a mismatch between the selected/detected type and the corpus
can never silently produce an incorrect "leaked" or "safe" verdict.

**Why this priority**: Correctness and trust in a security-critical tool. Lower
than P1/P2 because it hardens and simplifies an already-working path rather than
adding new detection capability.

**Independent Test**: Feed (a) an invalid hash-type value, (b) a SHA-1 corpus
while NTLM is explicitly selected, and (c) an unreadable/empty directory, then
verify each fails with a clear, actionable message and never returns misleading
results.

**Acceptance Scenarios**:

1. **Given** an invalid hash-type configuration, **When** the tool starts,
   **Then** it fails before scanning with a clear message listing valid values.
2. **Given** an explicitly selected hash type that is inconsistent with the
   corpus line format, **When** scanning starts, **Then** the inconsistency is
   handled per **FR-007** (explicit report in `error` mode; self-correct to the
   detected type and report the override in `warn` mode) instead of returning a
   wrong verdict.
3. **Given** auto-detection with a single-file corpus, **When** the first
   non-empty line has 40 characters before the separator, **Then** SHA-1 is
   selected; when it has 32, NTLM is selected.
4. **Given** auto-detection with a split-prefix directory (files named by a
   5-character prefix), **When** a prefix file is sampled, **Then** the hash type
   is determined from the file contents (35 characters before the separator →
   SHA-1, 27 → NTLM), not from the file name.

---

### Edge Cases

- **Unicode / non-ASCII passwords**: NTLM hashing MUST operate on the UTF-16LE
  encoding of the password; results MUST be consistent across platforms.
- **Empty passwords**: already filtered out before hashing; this must remain
  true regardless of hash type.
- **Mixed-case hex**: corpus lines and API responses may use upper- or lower-case
  hex; matching MUST be case-insensitive.
- **Line endings and padding**: corpora may use CRLF or LF and may contain blank
  lines; these must not affect detection or matching.
- **Malformed corpus lines**: a line whose hash-part length is neither the
  expected full-hash length (auto/selected) nor the expected suffix length for
  the mode MUST cause an explicit error, not be silently skipped or misread.
- **Auto-detection with no readable data**: an empty, incomplete, or unreadable
  directory yields no detectable type; the tool MUST require an explicit hash
  type and fail clearly rather than guess.
- **Corpus/hash-type mismatch**: scanning an NTLM corpus in SHA-1 mode (or vice
  versa) MUST NOT yield false matches; the mismatch must be detected and handled
  per the configured mismatch mode.
- **Index staleness (see FR-008)**: a previously built `.idx` index built for a
  different hash type or file size — including after a same-path,
  mtime-preserving corpus swap (`mv`, `cp -p`, `rsync -t`) or a legacy
  pre-metadata index — MUST NOT be reused; the recorded hash type and size are
  validated, not just the modification time.
- **Self-corrected run visibility**: when `warn` mode self-corrects to the
  detected hash type, the effective type and the override of the requested type
  MUST be visible in the summary and output.
- **Same password, both hash types**: a password present in both corpora must be
  matched only by the selected hash type for that run.
- **Very large corpora**: existing streaming/bounded-memory guarantees must hold
  for NTLM exactly as for SHA-1 (dataset is tens of GB and may grow 5–10×).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to select the hash type — `auto`, `sha1`, or
  `ntlm`. The default MUST be `auto`: for local corpora it detects the type from
  content (resolving to SHA-1 behavior for SHA-1 corpora), and for API mode it
  resolves to the existing SHA-1 behavior (FR-006). For users who make no
  selection, observable behavior is unchanged from today.
- **FR-002**: When NTLM is the active hash type, the system MUST derive each
  password's NTLM hash (the digest of the UTF-16LE-encoded password) and use it
  for all lookups, exactly as SHA-1 is used today in SHA-1 mode. The system MUST
  NOT hash with SHA-1 when NTLM is active.
- **FR-003**: Local single-file scanning MUST support NTLM corpora (32-character
  hashes before the separator), across all existing read modes (auto,
  sequential, binary, index).
- **FR-004**: Split-prefix directory scanning MUST support NTLM corpora, whose
  prefix files contain NTLM suffixes (27 characters before the separator).
- **FR-005**: HIBP API mode MUST request NTLM hash ranges and match NTLM
  suffixes; only the 5-character hash prefix may be transmitted.
- **FR-006**: With no explicit hash type configured, the default MUST be
  automatic detection for local corpora; for API mode, automatic detection is
  not possible and MUST resolve to the existing SHA-1 behavior, with a notice
  to the user. The notice MUST be written to stderr and echoed in the console
  summary, and MUST state that `auto` is not applicable to API mode, that SHA-1
  is being used, and how to select NTLM (`HASH_TYPE=ntlm`).
- **FR-007**: A mismatch between the active hash type and the corpus/response
  format MUST NOT silently produce an incorrect leak verdict, and MUST be
  governed by a dedicated mismatch mode with two values: `error` (default) —
  abort before scanning with a clear message naming the requested and detected
  types; and `warn` — emit a prominent warning and self-correct to the detected
  type, hashing passwords with that type so results remain correct. A
  "prominent warning" means a line written to stderr **and** echoed in the
  console summary that names both the requested type and the detected/effective
  (self-corrected) type, so the override is visible in both channels. When
  detection is ambiguous or the corpus is unreadable, both modes MUST abort
  rather than guess.

  Detection is **confident** only when samples unambiguously indicate exactly
  one type: for a single file, the first non-empty line's hash-part length is
  exactly one of {40 → SHA-1, 32 → NTLM}; for a split-prefix directory, a
  non-empty prefix file's suffix length (before the separator) is exactly one of
  {35 → SHA-1, 27 → NTLM}. Any other length, a corpus exhibiting both lengths
  (mixed), or **no non-empty sample** is ambiguous/unknown and MUST abort in
  both modes rather than guess.
- **FR-008**: The `.idx` index header MUST record the hash type (and file size)
  it was built for. An index whose recorded hash type or size does not match the
  current run MUST be treated as stale and automatically invalidated and
  rebuilt; legacy indexes lacking the marker MUST likewise be treated as stale.
  An index MUST never be silently applied to a different hash type.
- **FR-009**: An invalid hash-type configuration MUST be rejected with a clear
  message before any reading, hashing, or scanning begins.
- **FR-010**: Output MUST identify the hash type in use: each result MUST carry
  the active hash type (a CSV column and a JSON property), and the stored
  password hash field MUST reflect the hash type actually used (including any
  self-corrected type). The console summary MUST also state the hash type.
  Plaintext passwords MUST never be written unless the user has explicitly opted
  into including secrets.
- **FR-011**: User-facing summaries (including the dry-run summary) MUST show
  the active hash type and how it was chosen (explicit or detected).
- **FR-012**: Auto-detection MUST be deterministic and based on corpus content:
  full-hash length before the separator for single files (40 → SHA-1,
  32 → NTLM) and suffix length for split-prefix files (35 → SHA-1,
  27 → NTLM). It MUST NOT rely on file names.
- **FR-013**: Documentation (README, example environment file, CLI help) MUST
  describe the new option, the auto-detection behavior, and how to obtain NTLM
  corpora.
- **FR-014**: All existing SHA-1 behavior MUST remain fully backward-compatible
  when no NTLM selection is made.

### Key Entities

- **Hash Type**: the selected/detected hash type (SHA-1 or NTLM) that governs
  how passwords are hashed, the expected corpus line format, the API request
  mode, and read-mode validation.
- **NTLM Corpus**: the leaked-password dataset keyed by NTLM hashes (32 hex
  characters), grouped by 5-character prefix; may be a single file or a
  split-prefix directory of suffix-only files.
- **Range Response**: the API payload of hash suffixes and prevalence counts
  (27 characters for NTLM versus 35 for SHA-1), matched locally.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On an NTLM fixture corpus, 100% of planted passwords are reported
  with correct leak counts, and 0 hashes that exist only in an equivalent
  SHA-1 corpus are reported as matches.
- **SC-002**: A default run (no hash type set) against the existing SHA-1
  fixtures produces identical leak verdicts and counts to the current behavior
  (the only intentional output change is the hash-type field required by
  FR-010).
- **SC-003**: For the same password set, NTLM API mode and a local NTLM corpus
  return identical leak counts.
- **SC-004**: An invalid or mismatched hash type is reported before scanning
  completes, with a message naming the problem and the valid options.
- **SC-005**: The existing automated test suite passes unchanged, and new tests
  cover the NTLM file path, the NTLM split-directory path, and the NTLM API
  path.
- **SC-006**: Scanning an NTLM corpus uses bounded memory (no full-corpus load),
  consistent with the existing SHA-1 memory guarantees.
- **SC-007**: In `warn` mode (per FR-007) with an explicit hash type that
  conflicts with a confidently detected corpus type, the run self-corrects and
  produces results identical to a run configured with the correct type.

## Assumptions

- Hash type is configured explicitly (`sha1`, `ntlm`, or an automatic mode),
  defaulting to automatic detection; an explicit value always overrides
  detection.
- Configuration uses `HASH_TYPE` with values `auto` (default), `sha1`, or
  `ntlm`, and `HASH_TYPE_MISMATCH` with values `error` (default) or `warn`.
- Self-correction in `warn` mode only occurs when detection is confident and
  consistent (see FR-007 for the definition of confident); mixed or ambiguous
  corpus formats are treated as a data-integrity error and abort in both modes.
- Automatic detection applies to local corpora (single file or split-prefix
  directory). It does not apply to API mode, where the hash type must be known
  to form the request; automatic mode there resolves to the existing SHA-1
  behavior for backward compatibility and emits a notice.
- The split-prefix directory naming (files named by a 5-character hash prefix)
  is identical for SHA-1 and NTLM, so detection derives the type from file
  contents, never from file names.
- The NTLM corpus uses the standard HIBP downloaded NTLM format; the user is
  responsible for obtaining it (for example via the official Pwned Passwords
  Downloader's NTLM option).
- Node.js >= 26 remains the runtime baseline.
- Default behavior for existing users remains SHA-1 and is unchanged.
- A single run uses exactly one hash type; per-run dual-hash-type reporting
  is out of scope.
- Running NTLM hashing must not require weakening the process's cryptographic
  environment or adding untrusted dependencies; correctness of NTLM hashing is a
  hard requirement, verified against known reference vectors.
