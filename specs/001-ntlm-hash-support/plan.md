# Implementation Plan: NTLM Hash Support

**Branch**: `001-ntlm-hash-support` | **Date**: 2026-10-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-ntlm-hash-support/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary

Add NTLM hash support to the password leak checker. Users can select NTLM as the hash type (or use auto-detection), so passwords are hashed with NTLM (MD4 of UTF-16LE) for lookups against NTLM-formatted HIBP corpora (both local single-file and split-prefix directories, and HIBP API in NTLM mode). The feature includes hash-type selection, mismatch detection with error/warn modes, index metadata for hash type, and output identifying the active hash type. All existing SHA-1 behavior remains backward compatible by default.

## Technical Context

**Language/Version**: TypeScript with Node.js >= 26.0.0 (ES modules)

**Primary Dependencies**: argon2 ^0.45.0, chalk ^5.6.2, cli-progress ^3, fast-csv ^5.0.7, ora ^9.4.1, string-width ^8.2.2 (built-in crypto, fs, etc.)

**Storage**: Local filesystem (HIBP dataset files, indices, outputs). No external database.

**Testing**: Vitest (npm test), with unit (*.unit.test.ts), integration (*.integration.test.ts), and shared tests under tests/

**Target Platform**: Cross-platform (macOS/Linux/Windows)

**Project Type**: CLI tool / single-project

**Performance Goals**: Bounded memory (no full HIBP dataset load), streaming algorithms, support datasets 5-10x current size. Must match existing SHA-1 performance characteristics.

**Constraints**: Correctness and security are equal highest priorities (constitution). NTLM hashing must not require weakening the crypto environment (spec Assumptions; Constitution II). Verified on the Node 26 baseline: `crypto.getHashes()` excludes `md4` and `crypto.createHash('md4')` throws `error:0308010C ... unsupported` (OpenSSL 3 legacy provider), so MD4 is implemented **self-contained** in `src/crypto/md4.ts` (RFC 1320) and pinned to reference vectors; no `--openssl-legacy-provider` and no new dependency. Must never load full corpus into memory. Streaming/bounded memory required.

**Scale/Scope**: HIBP single-file ~89GB (~2B lines), split-prefix ~1M files. CLI with env vars and flags. Focused changes to existing codebase.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The feature aligns with all constitutional principles:
- **Correctness**: Explicit errors on mismatch/invalid config, no silent incorrect verdicts. Auto-detection based on content, deterministic behavior. 
- **Security**: NTLM is just a hash function for compatibility with HIBP NTLM corpus. Must not log/expose plaintext passwords; outputs follow existing secret handling. MD4 is required for NTLM format compatibility; because Node 26/OpenSSL 3 no longer exposes `md4`, it is implemented self-contained in `src/crypto/md4.ts` rather than by weakening the process crypto environment or adding a third-party crypto dependency. Plaintext passwords are materialized only as explicitly owned buffers in `hashPassword` and zeroed immediately after hashing (via `zeroBuffer()`), and MD4's internal password-derived working buffers are zeroed in a `finally` (see research.md → "Sensitive buffer lifetime").
- **Streaming & Bounded Memory**: All scanning paths remain streaming; no corpus loading.
- **Reliability**: Graceful handling of corrupted lines, mismatch modes, stale index invalidation.
- **Testable, Documented Code Quality**: Will add JSDoc, follow existing patterns.
- **Testing Discipline**: Add unit/integration tests for NTLM paths.
- **Validation Gates**: Will run lint, typecheck, full test suite before completion.

No constitutional violations anticipated.

## Project Structure

### Documentation (this feature)

```text
specs/001-ntlm-hash-support/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── checkPasswordsLeaks.ts
├── constants.ts
├── crypto/
│   ├── decryptBitwardenExport.ts
│   ├── extractPassword.ts
│   └── stretchKey.ts
├── envDefaults.ts
├── envLoader.ts
├── handlers/
├── hashing/
│   ├── buildLookupMap.ts
│   ├── detectSortedness.ts
│   ├── groupByPrefix.ts
│   ├── parseBuffer.ts
│   └── ...
├── io/
│   ├── modeResolver.ts
│   ├── processChunk.ts
│   ├── processDataLeaks.ts
│   ├── processHibpApi.ts
│   ├── processSingleFile.ts
│   ├── processSplitDirectory.ts
│   ├── readModeEvaluator.ts
│   └── readModes/
│       ├── binarySearch.ts
│       ├── indexBased.ts
│       └── sequential.ts
├── memory/
├── progress/
├── scripts/
└── types.ts

tests/
├── contract/
├── integration/
├── unit/
└── helpers/
```

**Structure Decision**: Single project CLI tool. Existing structure is appropriate. Changes will be localized to core modules (types, config/env, hashing logic, processing, io/read modes, outputs). No structural reorganization needed.

## Complexity Tracking

No constitutional violations are anticipated. All changes follow existing patterns and streaming principles. No complexity tracking entries needed.

## Phases

### Phase 0: Outline & Research

1. **Extract unknowns from Technical Context**:
   - NTLM hash computation approach in Node — RESOLVED: Node 26/OpenSSL 3 has no `md4`; use a self-contained RFC 1320 MD4 in `src/crypto/md4.ts` (UTF-16LE input, uppercase hex), pinned to reference vectors, without weakening the crypto environment
   - Index file format changes for hash type metadata (must retain the existing sorted flag)
   - Auto-detection logic exact implementation details
   - Mismatch handling flow across all code paths

2. **Generate and dispatch research agents**:
   For each area: config/env/types, hashing, detection, index format, processing paths, outputs. Research will focus on minimal invasive changes while preserving backward compatibility.

3. **Consolidate findings** in `research.md` with decisions, rationale, alternatives considered.

**Output**: research.md with all clarifications resolved

### Phase 1: Design & Contracts

**Prerequisites:** `research.md` complete

1. **Extract entities from feature spec** → `data-model.md`:
   - Hash Type (enum: sha1, ntlm, auto) with source (explicit/detected)
   - Hash Type Mismatch Mode (error/warn)
   - Active Hash Configuration
   - Index metadata (hashType, fileSize, mtime)

2. **Define interface contracts** (if applicable): CLI flags/env, internal APIs. This is a CLI tool - contracts may be internal interfaces and config schema. Document key interfaces.

3. **Create quickstart validation guide** → `quickstart.md`:
   - Setup test data with NTLM hashes (known vectors like 'password' → 8846F7EAEE8FB117AD06BDD830B7586C)
   - Scenarios for NTLM single-file, split-dir, API modes
   - Auto-detection, mismatch modes
   - Verify backward compatibility

**Output**: data-model.md, /contracts/*, quickstart.md

## Key rules

- Use absolute paths for filesystem operations; use project-relative paths for references in documentation
- ERROR on gate failures or unresolved clarifications
- Must comply with constitution at all gates

## Done When

- [x] Plan workflow executed and design artifacts generated
- [x] Constitution gates pass
- [x] All NEEDS CLARIFICATION resolved
