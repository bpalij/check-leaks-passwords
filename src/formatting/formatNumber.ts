/**
 * Format a number with space-separated thousands.
 *
 * Inserts a space every 3 digits in the integer part. Non-integer
 * parts are appended without a separator. Infinity values are
 * formatted as their string representation.
 *
 * @param number - The number to format.
 * @returns Formatted string (e.g., "1 234 567", "0.5", "Infinity").
 */
export function formatNumber(number: number): string {
  if (number === Infinity || number === -Infinity) {
    return `${number}`;
  }
  const intPartNumber = Math.floor(number);
  const notIntPartNumber = number - intPartNumber;
  const notIntPartString = `${notIntPartNumber}`.replace(/^0/, '');
  const intPartString = `${intPartNumber}`;
  const chars: string[] = [];
  for (let i = intPartString.length - 1, j = 0; i >= 0; i -= 1, j += 1) {
    if (j > 0 && j % 3 === 0) chars.push(' ');
    chars.push(intPartString[i]);
  }
  return `${chars.reverse().join('')}${notIntPartString}`;
}
