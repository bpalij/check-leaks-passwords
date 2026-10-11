/**
 * Parse an environment variable as an integer with min/max bounds.
 *
 * - undefined → fallback (no warning — user didn't touch it)
 * - non-numeric / below min → fallback + warning
 * - above max → cap to max + warning
 * - in range → use as-is
 *
 * @param name - The environment variable name to read.
 * @param min - Minimum allowed value (inclusive).
 * @param max - Maximum allowed value (inclusive).
 * @param fallback - Value to return when undefined, empty, or out of bounds.
 * @param logger - Optional logger for warning messages.
 * @returns The parsed integer within bounds, or the fallback.
 */
export function parseEnvInt(
  name: string,
  min: number,
  max: number,
  fallback: number,
  logger?: (message: string) => void,
): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) {
    logger?.(`${name}="${raw}" is not a valid integer (min ${min}), using ${fallback}`);
    return fallback;
  }
  if (n > max) {
    logger?.(`${name}=${n} exceeds maximum ${max}, using ${max}`);
    return max;
  }
  return n;
}
