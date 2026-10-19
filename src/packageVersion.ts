import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Default number of directories searched for `package.json`, counting the
 * start directory itself as level 0.
 *
 * The deepest known layout (`dist/src/<module>/`) resolves at level 3;
 * 10 leaves headroom for deeper source trees without allowing an
 * unbounded filesystem walk.
 */
const DEFAULT_MAX_DEPTH = 10;

/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * @param err - Caught value of any type.
 * @returns `err.message` for `Error` values, `String(err)` otherwise.
 */
const describeError = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Locate the nearest `package.json` at or above a starting directory.
 *
 * Walks up parent directories until a `package.json` exists. A missing
 * candidate (`ENOENT`) means "keep walking"; any other filesystem error,
 * exhausting `maxDepth`, or reaching the filesystem root without a match
 * is an explicit failure.
 *
 * Walking up (instead of a fixed `../../package.json` relative path) keeps
 * the lookup correct from every layout this project runs in: `src/` under
 * tsx/vitest, compiled `dist/src/`, and globally installed packages.
 *
 * @param startDir - Directory to start searching from (absolute or relative).
 * @param maxDepth - Maximum number of directories to inspect, counting
 *   `startDir` itself as level 0. Defaults to {@link DEFAULT_MAX_DEPTH}.
 * @returns Absolute path to the nearest existing `package.json`.
 * @throws {Error} If no `package.json` is found within `maxDepth`, or a
 *   filesystem error other than `ENOENT` occurs while checking.
 */
export function findNearestPackageJson(
  startDir: string,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): string {
  const root = path.resolve(startDir);
  let dir = root;
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    const candidate = path.join(dir, 'package.json');
    try {
      fs.accessSync(candidate, fs.constants.F_OK);
      return candidate;
    } catch (err) {
      const { code } = err as NodeJS.ErrnoException;
      if (code !== 'ENOENT') {
        throw new Error(`Failed to check ${candidate}: ${describeError(err)}`, { cause: err });
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root reached
    dir = parent;
  }
  throw new Error(`package.json not found within ${maxDepth} level(s) above ${root}`);
}

/**
 * Read the `version` field from the nearest `package.json` at or above a
 * starting directory.
 *
 * @param startDir - Directory to start the upward search from.
 * @param maxDepth - Maximum search depth, forwarded to
 *   {@link findNearestPackageJson}.
 * @returns The package version string (e.g. `0.0.0`).
 * @throws {Error} If no `package.json` is found, it cannot be read or
 *   parsed, or its `version` field is missing or not a non-empty string.
 */
export function readPackageVersion(
  startDir: string,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): string {
  const pkgPath = findNearestPackageJson(startDir, maxDepth);
  let raw: string;
  try {
    raw = fs.readFileSync(pkgPath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read ${pkgPath}: ${describeError(err)}`, { cause: err });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse ${pkgPath}: ${describeError(err)}`, { cause: err });
  }
  // Guard before destructuring: JSON.parse can legally yield null/array/primitives.
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Invalid ${pkgPath}: expected a JSON object`);
  }
  const { version } = parsed as { version?: unknown };
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`Invalid "version" in ${pkgPath}: expected a non-empty string`);
  }
  return version;
}

/**
 * Version of this package, read once at module load from the nearest
 * `package.json` above this file.
 *
 * @throws {Error} At module load if no `package.json` can be located or
 *   parsed — a broken installation fails fast instead of sending a wrong
 *   `User-Agent` version to the HIBP API.
 */
export const PACKAGE_VERSION = readPackageVersion(
  path.dirname(fileURLToPath(import.meta.url)),
);
