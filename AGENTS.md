# AGENTS.md

## Priorities

Critical priorities:

1. Correctness
2. Security

These are equally important. Never trade one against the other without strong justification.

Secondary priorities:

3. Reliability & Durability
4. Performance
5. Code Quality & Testability

Secondary priorities are ordered by importance. Prefer higher-ranked priorities when tradeoffs are required.

---

## Correctness

Incorrect output is unacceptable.

- Prefer explicit errors over incorrect results.
- Never silently drop, corrupt or transform data unless explicitly intended.
- Validate assumptions and important invariants.
- Consider normal, edge-case, corrupted, adversarial and very large inputs.
- Handle failures and invalid states explicitly.
- Before completion, review for logical bugs, hidden edge cases, incorrect assumptions and design flaws.
- Passing tests or compilation does not prove correctness.
- Verify both success and failure scenarios.
- If correctness cannot be guaranteed, stop and explain why.

---

## Security

Leaking secrets is unacceptable.

- Never send sensitive data externally.
- Never log or expose secrets.
- Never write secrets to disk except intended output.
- Minimize secret lifetime in memory.
- Avoid unnecessary copies of sensitive data.
- Clear sensitive buffers when practical.
- Never expose encryption keys, master passwords, cryptographic material or decrypted vault contents.
- Decrypt sensitive data only when necessary.
- Use secure defaults and look for security issues during implementation and review.
- Avoid unnecessary third-party dependencies in security-sensitive code.

Sensitive data includes:

- Bitwarden exports (encrypted/decrypted)
- encryption keys and cryptographic material
- master passwords
- passwords and password hashes
- vault secrets
- authentication tokens
- sensitive API responses
- derived values from secrets
- decrypted temporary data
- anything that can recover protected information

---

## Reliability & Durability

- Avoid crashes caused by bugs, invalid input or resource exhaustion.
- Handle corrupted input and I/O failures gracefully.
- Prefer streaming over large buffers.
- Release resources correctly and clean up after failures.
- Avoid partial outputs or corrupted temporary files.
- Produce deterministic results for identical inputs.
- Detect unexpected states instead of silently continuing.

---

## Performance

Assume pessimistic input sizes.

- Never design only for current dataset sizes.
- Avoid loading large datasets into memory.
- Prefer scalable algorithms and streaming.
- Minimize unnecessary work, allocations and copies.
- Consider algorithmic complexity and constant factors.
- Optimize without compromising correctness, security or reliability.
- Add complexity only when justified by real requirements.

---

## Code Quality & Testability

Unless conflicting with higher priorities:

- Keep code simple, readable and maintainable.
- Avoid overengineering and unnecessary abstraction.
- Follow good engineering principles (Clean Code, GRASP, SOLID where applicable).
- Prefer descriptive names and constants over magic numbers.
- Reduce duplication and keep modules focused.
- Prefer named exports.
- Keep code naturally testable.
- Avoid hidden state and unnecessary coupling.
- Do not suppress TypeScript/ESLint warnings without justification.
- Explain and ask before adding suppressions.
- Keep production and test code at the same quality level.
- Add JSDoc to all exported functions, classes, interfaces, types, and constants.
  Include @param, @returns, @throws, and @security tags where relevant.
- Add JSDoc to non-exported functions in security-critical modules (crypto/, memory/secureCleanup).
- Use inline comments for complex internal logic, non-obvious algorithms,
  and security-critical code paths. Do not over-document trivial code.
- Keep comments synchronized with code changes.

### Documentation Comments

Every exported symbol must have a JSDoc block that includes:

- One-line purpose description
- `@param` for each parameter (when non-obvious)
- `@returns` when the return value has non-obvious meaning or type
- `@throws` when the function throws conditionally
- `@security` tag for functions that handle sensitive data, perform
  cryptographic operations, or zero buffers

Non-exported functions in security-critical modules (`crypto/`, `memory/secureCleanup`)
must also have JSDoc.

Inline comments should explain:

- Non-obvious algorithms and data structures
- Security rationale (timing-safe comparison, buffer zeroing)
- Performance tradeoffs
- Workarounds for platform limitations

Do not document:

- Trivial getters, setters, or one-liner utilities
- Self-evident code
- Things that are obvious from the function name and types

Dependencies:

- Never use undeclared npm dependencies.
- Do not import packages missing from `package.json`.
- Prefer existing dependencies or standard library.
- Before adding a dependency, evaluate:
  - necessity;
  - alternatives;
  - security risks;
  - maintenance status;
  - size and compatibility.
- Prefer maintained, widely used packages.
- Explain meaningful dependency risks before adding them.

---

## Testing

- Add tests for behavioral changes.
- Add regression tests for bugs whenever practical.
- Use unit and integration tests where appropriate.
- Tests must be deterministic, reproducible and isolated.
- Never introduce flaky tests.
- Control time, randomness and external dependencies.
- Prefer behavior tests over implementation-detail tests.
- Test edge cases, failures and important invariants.
- Do not optimize only for coverage metrics; test meaningful behavior.

Test locations:

- Unit: `*.unit.test.ts` near implementation.
- Integration: `*.integration.test.ts` near implementation.
- Shared tests/fixtures/workflows: `tests/`.

---

## Validation

Before completion:

- Verify Node.js version satisfies `package.json` engine requirement. Prefer `.nvmrc` version for reproducibility — install/switch with nvm if available.
- Run linting.
- Run type checking.
- Run the complete test suite.
- Check coverage.
- Fix errors instead of suppressing them.
- Do not lower coverage thresholds without approval.
- If validation cannot be run, explain why.

---

## Behavior

- State assumptions when uncertain.
- Explain important tradeoffs.
- Present options before asking questions.
- Keep docs/specs synchronized with code.
- Treat code/tests as truth if documentation conflicts.
- Consider edge cases and failure modes before implementation.
- Avoid unrelated changes.
- Mention out-of-scope improvements separately.

---

## Project Context

This tool checks Bitwarden exports against HIBP datasets/APIs.
Encrypted Bitwarden JSON exports are supported. Encryption/decryption is security-critical.

Dataset (June, 2026):

Single-file HIBP:
- ~89 GB
- ~2 billion lines

Multi-file HIBP:
- ~89 GB
- 16^5 files (~1M files)
- ~55–99 KB per file

Rules:

- Never load the whole HIBP dataset into memory.
- Prefer streaming algorithms.
- Assume future datasets 5–10× larger.
- Consider worst-case memory and execution time.
- Avoid designs that only work for current sizes.