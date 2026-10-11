/** Keys to strip from the nested `login` object. */
const NESTED_SENSITIVE_KEYS = [
  'password',
  'totp',
  'fido2Credentials',
] as const;

/** Keys to strip from the top-level object. */
const TOP_LEVEL_SENSITIVE_KEYS = ['passwordHistory'] as const;

/**
 * Strip sensitive fields from a nested Bitwarden item.
 *
 * Removes `password`, `totp`, and `fido2Credentials` from the `login` object.
 *
 * @param obj - The object to strip.
 * @returns A new object with sensitive login fields removed.
 */
function stripNestedLoginSensitive(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  if (!('login' in obj) || typeof obj.login !== 'object' || obj.login === null) {
    return obj;
  }
  const result = { ...obj };
  const login = { ...result.login as Record<string, unknown> };
  NESTED_SENSITIVE_KEYS.forEach((key) => {
    delete login[key];
  });
  result.login = login;
  return result;
}

/**
 * Strip sensitive fields from a flat Bitwarden item.
 *
 * Removes `login_password`, `login_totp`, and `login_fido2Credentials`.
 *
 * @param obj - The object to strip.
 * @returns A new object with sensitive flat fields removed.
 */
function stripFlatSensitive(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...obj };
  NESTED_SENSITIVE_KEYS.forEach((key) => {
    delete result[`login_${key}`];
  });
  return result;
}

/**
 * Strip top-level sensitive fields (e.g., `passwordHistory`).
 *
 * @param obj - The object to strip.
 * @returns A new object with sensitive top-level fields removed.
 */
function stripTopLevelSensitive(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...obj };
  TOP_LEVEL_SENSITIVE_KEYS.forEach((key) => {
    delete result[key];
  });
  return result;
}

/**
 * Strip all sensitive fields from a password object.
 *
 * Removes plaintext passwords, TOTP secrets, FIDO2 credentials,
 * and password history. Handles both flat (CSV) and nested (JSON) formats.
 *
 * @template T - The type of the input object.
 * @param obj - The password object to strip.
 * @returns A new object with all sensitive fields removed.
 *
 * @security This function is critical for secure output — it prevents
 *   accidental inclusion of plaintext secrets in the output file.
 */
export function stripSensitiveFields<T extends Record<string, unknown>>(
  obj: T,
): T {
  let result = stripTopLevelSensitive(obj) as T;
  if ('login' in result) {
    result = stripNestedLoginSensitive(result) as T;
  } else {
    result = stripFlatSensitive(result) as T;
  }
  return result;
}
