import { expect } from 'vitest';

/**
 * Field names that carry a hash value and thus embed the algorithm token:
 * `login_password_sha1` / `login_password_ntlm` (record level) and
 * `hash_sha1` / `hash_ntlm` (JSON group level).
 */
const ALGORITHM_FIELD_PATTERN = /^(?:login_password|hash)_(sha1|ntlm)$/;

/**
 * Legacy field names that must never appear in output files (SC-003):
 * the generic record-level hash field, the per-record hash-type field, and
 * the bare group-level `hash` key.
 */
const LEGACY_FIELD_NAMES = [
  'login_password_hash',
  'login_password_hash_type',
  'hash',
];

/**
 * Assert that a whole output file uses exactly one algorithm token (FR-004).
 *
 * Scans every record-level (`login_password_<alg>`) and group-level
 * (`hash_<alg>`) field name of a single file and requires the set of
 * algorithm tokens found to contain exactly one distinct value — i.e. no
 * mixed `sha1`/`ntlm` names within one file. Catches order-array/emission
 * mismatches that per-field assertions miss (research.md D6).
 *
 * Callers must pass the complete set of field names of a file that contains
 * at least one record; an empty file has no token by definition and would
 * fail this assertion.
 *
 * @param fileFieldNames - Every field/column name occurring in one output
 *   file (CSV header columns; for JSON, the union of group keys and all
 *   record keys).
 * @throws AssertionError when zero or more than one distinct algorithm
 *   token is found.
 */
export function assertSingleAlgorithmToken(fileFieldNames: readonly string[]): void {
  const tokens = new Set<string>();
  fileFieldNames.forEach((name) => {
    const match = ALGORITHM_FIELD_PATTERN.exec(name);
    if (match) tokens.add(match[1]);
  });
  expect(
    [...tokens],
    `expected exactly one algorithm token across file fields, got: ${JSON.stringify([...tokens])} (fields: ${JSON.stringify(fileFieldNames)})`,
  ).toHaveLength(1);
}

/**
 * Assert that none of the legacy (pre-rename) field names occur in an
 * output file (SC-003).
 *
 * @param fileFieldNames - Every field/column name occurring in one output
 *   file (same contract as {@link assertSingleAlgorithmToken}).
 * @throws AssertionError when any forbidden legacy name is present.
 */
export function assertLegacyFieldsAbsent(fileFieldNames: readonly string[]): void {
  LEGACY_FIELD_NAMES.forEach((legacy) => {
    expect(
      fileFieldNames,
      `legacy field "${legacy}" must not appear in output`,
    ).not.toContain(legacy);
  });
}
