/**
 * Format a duration between two Temporal.Instants into a human-readable string.
 *
 * Produces output like "1d 2h 30min 0sec 0ms" or "0ms".
 * Only non-zero units (and units after the first non-zero) are included.
 *
 * @param instant1 - First time instant.
 * @param instant2 - Second time instant.
 * @returns Formatted duration string (e.g., "1d 2h 30min 0sec 0ms", "0ms").
 */
export function formatDuration(instant1: Temporal.Instant, instant2: Temporal.Instant): string {
  const absoluteDifferenceInMs = Math.floor(
    Math.abs(instant1.epochMilliseconds - instant2.epochMilliseconds),
  );

  const msInSecond = 1000;
  const msInMinute = msInSecond * 60;
  const msInHour = msInMinute * 60;
  const msInDay = msInHour * 24;

  const spentDays = Math.floor(absoluteDifferenceInMs / msInDay);
  const diffWithoutDays = absoluteDifferenceInMs - spentDays * msInDay;
  const spentHours = Math.floor(diffWithoutDays / msInHour);
  const diffWithoutHours = diffWithoutDays - spentHours * msInHour;
  const spentMinutes = Math.floor(diffWithoutHours / msInMinute);
  const diffWithoutMinutes = diffWithoutHours - spentMinutes * msInMinute;
  const spentSeconds = Math.floor(diffWithoutMinutes / msInSecond);
  const spentMs = diffWithoutMinutes - spentSeconds * msInSecond;

  const unitDefinitions: Array<{ value: number; label: string }> = [
    { value: spentDays, label: 'd' },
    { value: spentHours, label: 'h' },
    { value: spentMinutes, label: 'min' },
    { value: spentSeconds, label: 'sec' },
    { value: spentMs, label: 'ms' },
  ];

  let foundNonZero = false;
  const parts: string[] = [];
  unitDefinitions.forEach(({ value, label }) => {
    if (value !== 0 || foundNonZero) {
      foundNonZero = true;
      parts.push(`${value}${label}`);
    }
  });

  return foundNonZero ? parts.join(' ') : '0ms';
}
