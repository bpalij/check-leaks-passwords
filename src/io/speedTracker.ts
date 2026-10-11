/** Default window size for speed calculation (1000 samples). */
const DEFAULT_WINDOW_SIZE = 1000;

/**
 * Create a sliding-window speed tracker.
 *
 * Records timestamped values and computes throughput (values per second)
 * over the most recent 1-second window. Used for progress bar speed display.
 *
 * @param windowSize - Maximum number of samples to retain (default: 1000).
 * @returns Object with a `record()` method that returns the current speed.
 */
export function createSpeedTracker(windowSize: number = DEFAULT_WINDOW_SIZE): {
  record(value: number): number;
} {
  const times = new Float64Array(windowSize);
  const values: number[] = new Array(windowSize).fill(0);
  let head = 0;

  return {
    /**
     * Record a new value and compute the current speed.
     *
     * @param value - Cumulative value (e.g., total bytes processed).
     * @returns Speed in values per second over the last 1-second window.
     */
    record(value: number): number {
      const now = Date.now();
      times[head % windowSize] = now;
      values[head % windowSize] = value;
      head += 1;

      let speed = 0;
      const maxCount = Math.min(head, windowSize);
      const cutoff = now - 1000;
      let count = maxCount;
      while (count > 1 && times[(head - count) % windowSize] < cutoff) {
        count -= 1;
      }
      if (count >= 2) {
        const firstIdx = (head - count) % windowSize;
        const lastIdx = (head - 1) % windowSize;
        const dt = times[lastIdx] - times[firstIdx];
        if (dt > 0) {
          speed = Math.round(((values[lastIdx] - values[firstIdx]) / dt) * 1000);
        }
      }
      return speed;
    },
  };
}
