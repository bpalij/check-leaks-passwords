import fs from 'fs';

import {
  IDX_HEADER_SIZE,
  IDX_SORTED_FLAG_OK,
  SHA1_HEX_LENGTH,
  SMALL_FILE_BYTES_THRESHOLD,
} from '../constants.js';
import type { SortednessVerdict } from '../types.js';
import { checkIndexHeader, decodeIndexHeader, hashTypeCodeFor } from '../io/indexHeader.js';
import {
  assertNonOverlapInvariant,
  checkAlignedWindowSorted,
  checkBufferSorted,
  computeRegionCount,
  computeSampleOffsets,
  readRegionSample,
} from './sortednessSampling.js';

/** Head/tail adjacency window size in bytes (100 lines x ~80 bytes). */
const HEAD_TAIL_WINDOW_BYTES = 100 * 80;

/**
 * Detect whether a HIBP corpus is sorted, with a tri-state verdict.
 *
 * Order of checks (each gate must not run before the previous one):
 * 1. Skip gate: `fileSize < SMALL_FILE_BYTES_THRESHOLD` → `skipped` — no
 *    corpus reads and no `.idx` consultation at all (FR-011, D2).
 * 2. Cache gate: a fresh V3 `.idx` header (strictly newer mtime, version
 *    `IDX_VERSION_V3`, matching hash type and file size) is trusted for its
 *    sorted flag; any stale/V2/legacy/truncated header falls through to the
 *    live check and is never trusted (FR-008).
 * 3. Live check: bounded 8000-byte head and tail adjacency windows (FR-004),
 *    then N = clamp(ceil(F / 4 GiB), 20, 256) deterministic evenly spaced
 *    4096-byte region samples with intra-region adjacency verification and
 *    cross-region anchor ordering (FR-001, FR-003, FR-013). Offsets are a
 *    pure function of fileSize — identical corpora yield identical verdicts
 *    (FR-002, FR-010).
 *
 * @param filePath - Path to the HIBP hashes file.
 * @param fullHashLength - Length of a full hex hash (40 for SHA-1, 32 for NTLM).
 *   Defaults to 40 (SHA-1).
 * @returns `sorted`, `unsorted`, or `skipped` (below the 1 GiB threshold).
 * @throws {Error} On the non-overlap invariant violation or I/O failures —
 *   explicit failures, never silent passes (FR-012).
 * @security Reads password hashes from the corpus; no hash values are ever
 *   logged (FR-015).
 */
export async function detectSortedness(
  filePath: string,
  fullHashLength: number = SHA1_HEX_LENGTH,
): Promise<SortednessVerdict> {
  const stat = await fs.promises.stat(filePath);
  const fileSize = stat.size;

  // Gate 1 — skip gate: before any .idx stat/open or corpus read (D2, FR-011).
  if (fileSize < SMALL_FILE_BYTES_THRESHOLD) return 'skipped';

  // Gate 2 — V3 cache consult: the 19-byte header is read as a whole, so the
  // version/hash-type/size checks cost no extra I/O (D5).
  const idxPath = `${filePath}.idx`;
  try {
    const idxStat = await fs.promises.stat(idxPath);
    if (idxStat.mtimeMs > stat.mtimeMs) {
      await using idxFd = await fs.promises.open(idxPath, 'r');
      const headerBuf = Buffer.alloc(IDX_HEADER_SIZE);
      const { bytesRead } = await idxFd.read(headerBuf, 0, IDX_HEADER_SIZE, 0);
      if (bytesRead === IDX_HEADER_SIZE) {
        const check = checkIndexHeader(
          decodeIndexHeader(headerBuf),
          { hashType: hashTypeCodeFor(fullHashLength), fileSize },
        );
        if (check.ok) {
          // eslint-disable-next-line no-bitwise -- flag byte unpacking
          return (headerBuf[0] & IDX_SORTED_FLAG_OK) !== 0 ? 'sorted' : 'unsorted';
        }
      }
      // Stale (V2/legacy, truncated, wrong hash type or size): re-verify live.
    }
  } catch { /* .idx file not found — live check */ }

  // Gate 3 — live deterministic check.
  await using fd = await fs.promises.open(filePath, 'r');

  const headBytes = Math.min(HEAD_TAIL_WINDOW_BYTES, fileSize);
  const headBuf = Buffer.alloc(headBytes);
  const { bytesRead: headRead } = await fd.read(headBuf, 0, headBytes, 0);
  if (!checkBufferSorted(headBuf.subarray(0, headRead), fullHashLength)) return 'unsorted';

  // The tail window starts at an arbitrary mid-line offset — skip its partial
  // first line so the fragment cannot yield a bogus hash comparison.
  const tailBuf = Buffer.alloc(headBytes);
  const { bytesRead: tailRead } = await fd.read(tailBuf, 0, headBytes, fileSize - headBytes);
  if (!checkAlignedWindowSorted(tailBuf.subarray(0, tailRead), fullHashLength)) return 'unsorted';

  const regionCount = computeRegionCount(fileSize);
  assertNonOverlapInvariant(fileSize, regionCount);
  const offsets = computeSampleOffsets(fileSize, regionCount);

  let prevAnchor: string | null = null;
  for (let i = 0; i < offsets.length; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { anchor, adjacentInRegion } = await readRegionSample(fd, offsets[i], fullHashLength);
      if (!adjacentInRegion) return 'unsorted';
      if (prevAnchor !== null && prevAnchor > anchor) return 'unsorted';
      prevAnchor = anchor;
    } catch (err) {
      // A window with no complete line is an explicit failure condition
      // (corrupted input or constant drift) — reported unsorted with a
      // diagnostic, never a silent pass (contract §5). Diagnostic carries an
      // offset only, never corpus content (FR-015).
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`Sortedness check diagnostic: ${detail}`);
      return 'unsorted';
    }
  }

  return 'sorted';
}
