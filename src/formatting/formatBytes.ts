import { stripTrailingZeros } from './stripTrailingZeros.js';

/** Byte size units from bytes to terabytes. */
const UNITS = [
  'B',
  'KB',
  'MB',
  'GB',
  'TB',
];

/**
 * Format a byte count into a human-readable string.
 *
 * Uses powers of 1024 to select the appropriate unit. Precision varies
 * by magnitude: 2 decimal places for <100, 1 for <1000, 0 for >=1000.
 *
 * @param bytes - The number of bytes to format.
 * @returns Formatted string (e.g., "1.5KB", "500MB", "1TB").
 */
export function formatBytes(bytes: number): string {
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < UNITS.length - 1) {
    val /= 1024;
    idx += 1;
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
  return `${stripped}${UNITS[idx]}`;
}
