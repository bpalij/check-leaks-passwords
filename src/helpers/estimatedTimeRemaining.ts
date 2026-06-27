import timeDurationBetweenDatesInWords from './timeDurationBetweenDatesInWords';

export default function estimatedTimeRemaining(
  processed: number,
  total: number,
  elapsedMs: number,
): string | undefined {
  if (processed <= 0 || total <= 0 || elapsedMs <= 0) return undefined;
  const fractionDone = processed / total;
  if (fractionDone >= 1) return undefined;
  const estimatedTotalMs = elapsedMs / fractionDone;
  const remainingMs = Math.round(estimatedTotalMs - elapsedMs);
  if (remainingMs <= 0) return undefined;
  return timeDurationBetweenDatesInWords(new Date(0), new Date(remainingMs));
}
