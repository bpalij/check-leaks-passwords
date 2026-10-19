import fs from 'fs';

/**
 * Set of tracked sensitive buffers that must be zeroed on process exit.
 *
 * Buffers are tracked via `trackBuffer()` and untracked via `untrackBuffer()`.
 * On SIGINT, SIGTERM, uncaughtException, or unhandledRejection, all tracked
 * buffers are zeroed before the process exits. Fatal errors are reported
 * to stderr before exit so failures are never silent.
 */
const trackedBuffers = new Set<Buffer>();

/**
 * Register a buffer for automatic zeroing on process exit.
 *
 * @param buf - The buffer to track.
 * @security The buffer contains sensitive data (keys, passwords, etc.).
 */
export const trackBuffer = (buf: Buffer): void => {
  trackedBuffers.add(buf);
};

/**
 * Unregister a buffer from automatic zeroing.
 *
 * Call after manually zeroing a buffer to avoid double-zeroing.
 *
 * @param buf - The buffer to untrack.
 */
export const untrackBuffer = (buf: Buffer): void => {
  trackedBuffers.delete(buf);
};

/**
 * Zero a buffer by filling it with null bytes.
 *
 * Handles null and undefined gracefully (no-op). This is a security
 * best practice to minimize the lifetime of sensitive data in memory.
 *
 * @param buf - The buffer to zero, or null/undefined.
 *
 * @security Uses `Buffer.fill(0)` to overwrite the buffer contents.
 *   This is best-effort — JavaScript's garbage collector may have
 *   already copied the data. For maximum security, use
 *   `--max-old-space-size` and avoid large allocations.
 */
export const zeroBuffer = (buf: Buffer | null | undefined): void => {
  if (buf && Buffer.isBuffer(buf)) {
    buf.fill(0);
  }
};

/**
 * Zero all tracked buffers and clear the tracking set.
 *
 * Called on process exit signals (SIGINT, SIGTERM) and uncaught exceptions
 * to ensure sensitive data is overwritten before the process terminates.
 *
 * @security Zeroes all buffers registered via `trackBuffer()`.
 */
export const zeroAllTracked = (): void => {
  trackedBuffers.forEach((buf) => {
    buf.fill(0);
  });
  trackedBuffers.clear();
};

/**
 * Exit handler that zeros all tracked buffers before calling process.exit().
 *
 * @param code - The process exit code.
 */
const cleanupAndExit = (code: number) => {
  zeroAllTracked();
  process.exit(code);
};

/**
 * Write a fatal error report to stderr synchronously, best-effort.
 *
 * `fs.writeSync(2, ...)` is used instead of `console.error`/`process.stderr`
 * because buffered stderr writes to pipes are asynchronous on some platforms
 * and would be truncated by the `process.exit()` that follows immediately.
 * A failed write (e.g. closed stderr) is swallowed — reporting must never
 * prevent the process from exiting.
 *
 * @param header - Short label naming the fatal event.
 * @param detail - Uncaught error or unhandled rejection reason. `Error`
 *   values are rendered via their stack; everything else via `String()`.
 *
 * @security Call only after `zeroAllTracked()`; writes just the error value,
 *   never tracked sensitive buffers.
 */
const writeFatalErrorToStderr = (header: string, detail: unknown): void => {
  const text = detail instanceof Error ? (detail.stack ?? detail.message) : String(detail);
  try {
    fs.writeSync(2, `${header} ${text}\n`);
  } catch {
    // stderr unavailable — exit anyway
  }
};

// Register signal handlers to zero sensitive buffers on exit
process.on('SIGINT', () => { cleanupAndExit(130); });
process.on('SIGTERM', () => { cleanupAndExit(143); });
// Fatal handlers: zero first (minimize secret lifetime), then report, then
// exit — replacing Node's default silent suppression of these events.
process.on('uncaughtException', (err: Error) => {
  zeroAllTracked();
  writeFatalErrorToStderr('Uncaught exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason: unknown) => {
  zeroAllTracked();
  writeFatalErrorToStderr('Unhandled rejection:', reason);
  process.exit(1);
});
