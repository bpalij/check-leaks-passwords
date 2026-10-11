/**
 * Strip trailing zeros from a formatted decimal string.
 *
 * Removes trailing zeros after the decimal point and the decimal
 * point itself if no fractional part remains.
 *
 * @param trimmed - The formatted decimal string to clean.
 * @returns String with trailing zeros removed.
 *
 * @example
 * stripTrailingZeros("1.50") // "1.5"
 * stripTrailingZeros("2.00") // "2"
 * stripTrailingZeros("3")    // "3"
 */
export function stripTrailingZeros(trimmed: string): string {
  return trimmed.replace(/(\.[0-9]*?)0+$/, '$1').replace(/\.$/, '');
}
