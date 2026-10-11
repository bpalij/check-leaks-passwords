# check-leaks-passwords Constitution

## Core Principles

### I. Correctness Above All (NON-NEGOTIABLE)
Incorrect output is unacceptable. Prefer explicit errors over incorrect results.
MUST NOT silently drop, corrupt, or transform data unless explicitly intended.
Validate assumptions and important invariants. Consider normal, edge-case,
corrupted, adversarial, and very large inputs. Handle failures and invalid states
explicitly. Before completion, MUST review for logical bugs, hidden edge cases,
incorrect assumptions, and design flaws. Passing tests or compilation MUST NOT be
treated as proof of correctness. Verify both success and failure scenarios. If
correctness cannot be guaranteed, MUST stop and explain why.

### II. Secret Confidentiality & Cryptographic Safety (NON-NEGOTIABLE)
Leaking secrets is unacceptable. MUST NOT send sensitive data externally, log or
expose secrets, or write secrets to disk except as intended output. Minimize
secret lifetime in memory; clear sensitive buffers when practical. Avoid
unnecessary copies of sensitive data. MUST NOT expose encryption keys, master
passwords, cryptographic material, or decrypted vault contents. Decrypt sensitive
data only when necessary. Use secure defaults and audit security issues during
implementation and review. Avoid unnecessary third-party dependencies in
security-critical code. Sensitive data includes: Bitwarden exports
(encrypted/decrypted), encryption keys and cryptographic material, master
passwords, passwords and password hashes, vault secrets, authentication tokens,
sensitive API responses, derived values from secrets, decrypted temporary data,
and anything that can recover protected information.

### III. Streaming & Bounded Memory (NON-NEGOTIABLE)
MUST NOT load the whole HIBP dataset into memory. Prefer streaming algorithms and
scalable designs. Assume pessimistic input sizes: never design only for current
sizes and assume future datasets 5–10× larger. Minimize unnecessary work,
allocations, and copies. Consider worst-case memory and execution time. Optimize
without compromising correctness, security, or reliability, and add complexity
only when justified by real requirements.

### IV. Reliability & Determinism
Avoid crashes caused by bugs, invalid input, or resource exhaustion. Handle
corrupted input and I/O failures gracefully. Prefer streaming over large buffers.
Release resources correctly and clean up after failures. Avoid partial outputs or
corrupted temporary files. Produce deterministic results for identical inputs.
Detect unexpected states instead of silently continuing.

### V. Testable, Documented Code Quality
Keep code simple, readable, and maintainable. Avoid overengineering and
unnecessary abstraction. Follow good engineering principles (Clean Code, GRASP,
SOLID where applicable). Prefer descriptive names and constants over magic
numbers. Reduce duplication and keep modules focused. Prefer named exports. Keep
code naturally testable; avoid hidden state and unnecessary coupling. MUST NOT
suppress TypeScript/ESLint warnings without justification. Add JSDoc to all
exported functions, classes, interfaces, types, and constants, including
@param, @returns, @throws, and @security where relevant. Non-exported functions in
security-critical modules (`crypto/`, `memory/secureCleanup`) MUST also have
JSDoc. Use inline comments for complex internal logic, non-obvious algorithms,
and security-critical code paths; do not over-document trivial code. Keep
comments synchronized with code.

### VI. Testing Discipline
Add tests for behavioral changes and regression tests for bugs whenever
practical. Use unit and integration tests where appropriate. Tests MUST be
deterministic, reproducible, and isolated; MUST NOT be flaky. Control time,
randomness, and external dependencies. Prefer behavior tests over
implementation-detail tests. Test edge cases, failures, and important invariants.
Do not optimize only for coverage metrics; test meaningful behavior. Test
locations: unit tests as `*.unit.test.ts` near implementation; integration tests
as `*.integration.test.ts` near implementation; shared tests/fixtures/workflows
under `tests/`.

### VII. Validation Gates Before Completion
Before completion, MUST verify the Node.js version satisfies the `package.json`
engine requirement, preferring the `.nvmrc` version for reproducibility. MUST run
linting, type checking, and the complete test suite, and check coverage. Fix
errors instead of suppressing them. MUST NOT lower coverage thresholds without
approval. If validation cannot be run, explain why.

## Additional Constraints

**Priority order.** Correctness and Security are critical and equally important;
MUST NOT trade one against the other without strong justification. Secondary
priorities, in order of importance, are Reliability & Durability, Performance,
then Code Quality & Testability. Prefer higher-ranked priorities when tradeoffs
are required.

**Dependency policy.** MUST NOT use undeclared npm dependencies or import
packages missing from `package.json`. Prefer existing dependencies or the
standard library. Before adding a dependency, evaluate necessity, alternatives,
security risks, maintenance status, and size compatibility. Prefer maintained,
widely used packages, and explain meaningful dependency risks before adding them.

**Dataset facts (2026-06).** The single-file HIBP dataset is ~89 GB with ~2
billion lines; the multi-file form is ~89 GB across 16^5 (~1M) files of ~55–99 KB
each. These constraints drive Principle III: never load the whole dataset into
memory, prefer streaming, assume 5–10× growth, and bound worst-case memory and
execution time.

## Development Workflow & Quality Gates

Every change MUST pass the validation gates in Principle VII before completion:
Node version check, lint, typecheck, complete test suite, and coverage. Keep
docs/specs synchronized with code; treat code/tests as truth if documentation
conflicts. State assumptions when uncertain, explain important tradeoffs, and
present options before asking questions. Consider edge cases and failure modes
before implementation. Avoid unrelated changes; mention out-of-scope improvements
separately. Code review MUST verify constitution compliance.

## Governance

This constitution supersedes all other project practices where they conflict.
`AGENTS.md` is the runtime development guidance file and MUST be consulted for
operational detail; it MUST NOT override this constitution. Amendments MUST be
documented, versioned according to the policy below, and applied to
`.specify/memory/constitution.md`; a migration note MUST accompany structural
changes. The `/speckit.plan` Constitution Check gate MUST pass before research
and MUST be re-checked after design; complexity violations MUST be justified.
Versioning follows semantic versioning: MAJOR for backward-incompatible governance
or principle removals/redefinitions, MINOR for a new principle/section or
materially expanded guidance, PATCH for clarifications and non-semantic
refinements. If the bump type is ambiguous, reasoning MUST be proposed before
finalizing.

**Version**: 1.0.0 | **Ratified**: 2026-10-11 | **Last Amended**: 2026-10-11