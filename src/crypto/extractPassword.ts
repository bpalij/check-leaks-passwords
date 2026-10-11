import { PasswordObject, FlatPasswordObject, NestedPasswordObject } from '../types.js';

/**
 * Extract the plaintext password from a password object.
 *
 * Handles both flat (CSV) and nested (JSON) Bitwarden export formats:
 * - Flat: `obj.login_password`
 * - Nested: `obj.login.password`
 *
 * @param obj - A password object in either flat or nested format.
 * @returns The plaintext password, or empty string if missing.
 *
 * @security The returned string contains a plaintext password.
 *   Caller must handle lifecycle and avoid logging.
 */
export function extractPassword(obj: PasswordObject): string {
  if ('login' in obj && obj.login) {
    return (obj as NestedPasswordObject).login.password ?? '';
  }
  return (obj as FlatPasswordObject).login_password ?? '';
}
