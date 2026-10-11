import { execSync } from 'child_process';
import os from 'os';

/** Cached available memory value (bytes). Populated on first call. */
let cached: number | undefined;

/**
 * Get the available system memory in bytes.
 *
 * On macOS, uses `vm_stat` to include inactive pages (which the OS
 * can reclaim). Falls back to `os.freemem()` on other platforms or
 * if `vm_stat` fails. Result is cached after first call.
 *
 * @returns Available memory in bytes.
 */
export function getAvailableMemBytes(): number {
  if (cached !== undefined) return cached;

  if (process.platform === 'darwin') {
    try {
      const stats = execSync('vm_stat', { encoding: 'utf-8', timeout: 1000 });
      const freeMatch = stats.match(/Pages free:\s+(\d+)/)?.[1];
      const inactiveMatch = stats.match(/Pages inactive:\s+(\d+)/)?.[1];
      if (freeMatch && inactiveMatch) {
        const pagesFree = parseInt(freeMatch, 10);
        const pagesInactive = parseInt(inactiveMatch, 10);
        cached = (pagesFree + pagesInactive) * 4096;
        return cached;
      }
    } catch {
      // fallback to os.freemem()
    }
  }
  cached = os.freemem();
  return cached;
}
