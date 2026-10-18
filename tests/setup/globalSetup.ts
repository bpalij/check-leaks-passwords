import fs from 'fs';
import path from 'path';

/** Parent of every per-worker sandbox directory. */
const TEST_TMP_PARENT = path.resolve(import.meta.dirname, '..', '__output__', '_tmp');

/**
 * Vitest global setup: wipe the test sandbox once before the run starts.
 *
 * Removes leftovers from a previous crashed/aborted run; the per-worker
 * directories themselves are recreated lazily by `makeTestDir`.
 */
export function setup(): void {
  fs.rmSync(TEST_TMP_PARENT, { recursive: true, force: true });
}
