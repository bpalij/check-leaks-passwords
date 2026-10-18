import fs from 'fs';
import path from 'path';

/**
 * Root directory for all test temporary artifacts.
 *
 * Located under the gitignored `tests/__output__/` tree rather than the system
 * temp directory, so tests never write to `os.tmpdir()`. The path is keyed by
 * the worker PID: each Vitest worker cleans only its own directory, which keeps
 * `fileParallelism` safe (one worker cannot delete another's in-flight files).
 */
const TEST_TMP_ROOT = path.join(
  path.resolve(import.meta.dirname, '..', '__output__', '_tmp'),
  `w${process.pid}`,
);

/** Monotonic counter guaranteeing unique file names within a worker. */
let fileCounter = 0;

/**
 * Create the per-worker root directory if it does not exist yet.
 */
function ensureRoot(): void {
  fs.mkdirSync(TEST_TMP_ROOT, { recursive: true });
}

/**
 * Create a fresh, uniquely named temporary directory under the sandbox root.
 *
 * @param prefix - Directory name prefix (must not contain path separators).
 * @returns Absolute path to the created directory.
 */
export function makeTestDir(prefix = 'tmp-'): string {
  ensureRoot();
  return fs.mkdtempSync(path.join(TEST_TMP_ROOT, prefix));
}

/**
 * Build a fresh, uniquely named temporary file path under the sandbox root.
 *
 * The file itself is not created; callers write to it. The returned path is
 * unique per call within a worker, so tests may use it directly without
 * `Date.now()`-based collisions.
 *
 * @param name - Desired file name (may include an extension).
 * @returns Absolute path to use for the temporary file.
 */
export function makeTestFilePath(name: string): string {
  ensureRoot();
  fileCounter += 1;
  return path.join(TEST_TMP_ROOT, `${fileCounter}-${name}`);
}

/**
 * Remove every temporary artifact created by this worker.
 *
 * Safe to call even when nothing was created. Intended as a per-file safety
 * net (registered via `setupFiles`) so cleanup still runs when an individual
 * test times out and its own `finally`/`afterEach` hooks are skipped.
 */
export function cleanupTestTmp(): void {
  fileCounter = 0;
  fs.rmSync(TEST_TMP_ROOT, { recursive: true, force: true });
}
