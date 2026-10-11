import { stripTrailingZeros } from './stripTrailingZeros.js';

/**
 * Format a number into a compact notation with K/M/B suffixes.
 *
 * Uses powers of 1000 for the suffix. Values below 1000 are returned
 * as-is. Precision varies by magnitude: 2 decimal places for <100,
 * 1 for <1000, 0 for >=1000.
 *
 * @param n - The number to format.
 * @returns Formatted string (e.g., "1.5M", "500K", "2B").
 */
export function formatCompact(n: number): string {
  let val: number;
  let suffix: string;
  if (n >= 1_000_000_000) {
    val = n / 1_000_000_000;
    suffix = 'B';
  } else if (n >= 1_000_000) {
    val = n / 1_000_000;
    suffix = 'M';
  } else if (n >= 1_000) {
    val = n / 1_000;
    suffix = 'K';
  } else {
    return `${n}`;
  }
  let trimmed: string;
  if (val < 100) {
    trimmed = val.toFixed(2);
  } else if (val < 1000) {
    trimmed = val.toFixed(1);
  } else {
    trimmed = val.toFixed(0);
  }
  const stripped = stripTrailingZeros(trimmed);
  return `${stripped}${suffix}`;
}
