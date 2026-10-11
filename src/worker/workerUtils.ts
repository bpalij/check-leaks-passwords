/**
 * Reference flag used to track whether a worker has settled (resolved or rejected).
 *
 * Ensures a worker is only terminated and rejected once, even if
 * multiple error or exit events fire.
 */
export interface WorkerSettledRef {
  /** Whether the worker has already settled. */
  current: boolean;
}

/**
 * Handle a worker error by terminating the worker and rejecting the promise.
 *
 * Only fires once per settled ref — subsequent calls are no-ops.
 *
 * @param settledRef - Shared settled flag.
 * @param worker - The Node.js worker to terminate.
 * @param worker.terminate - The worker's terminate function.
 * @param reject - The promise rejection callback.
 * @param err - The error that occurred.
 * @param onComplete - Optional cleanup callback invoked after rejection.
 */
export function handleWorkerError(
  settledRef: WorkerSettledRef,
  worker: { terminate: () => Promise<number> },
  reject: (reason?: unknown) => void,
  err: Error,
  onComplete?: () => void,
): void {
  const ref = settledRef;
  if (!ref.current) {
    ref.current = true;
    worker.terminate();
    reject(err);
    onComplete?.();
  }
}

/**
 * Handle a worker exit with a non-zero code by rejecting the promise.
 *
 * Only fires once per settled ref — subsequent calls are no-ops.
 *
 * @param settledRef - Shared settled flag.
 * @param reject - The promise rejection callback.
 * @param code - The exit code from the worker process.
 * @param onComplete - Optional cleanup callback invoked after rejection.
 */
export function handleWorkerExit(
  settledRef: WorkerSettledRef,
  reject: (reason?: unknown) => void,
  code: number,
  onComplete?: () => void,
): void {
  const ref = settledRef;
  if (!ref.current && code !== 0) {
    ref.current = true;
    reject(new Error(`Worker exited with code ${code}`));
    onComplete?.();
  }
}
