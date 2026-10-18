import {
  MAX_LINE_BYTES,
  SORTEDNESS_MAX_REGIONS,
  SORTEDNESS_MIN_REGIONS,
  SORTEDNESS_REGION_READ_BYTES,
  SORTEDNESS_SAMPLE_STRATA_BYTES,
} from '../constants.js';
import {
  assertNonOverlapInvariant,
  checkAlignedWindowSorted,
  checkBufferSorted,
  computeRegionCount,
  computeSampleOffsets,
} from './sortednessSampling.js';

const GIB = 1024 * 1024 * 1024;
const TIB = 1024 * GIB;

describe('computeRegionCount', () => {
  it('clamps to the minimum (20) at the 1 GiB threshold', () => {
    expect(computeRegionCount(GIB)).toBe(SORTEDNESS_MIN_REGIONS);
  });

  it('clamps to the minimum (20) for sizes below one stratum', () => {
    expect(computeRegionCount(80 * GIB)).toBe(SORTEDNESS_MIN_REGIONS);
    expect(computeRegionCount(SORTEDNESS_SAMPLE_STRATA_BYTES - 1)).toBe(SORTEDNESS_MIN_REGIONS);
  });

  it('scales linearly between min and max', () => {
    expect(computeRegionCount(100 * GIB)).toBe(25);
    expect(computeRegionCount(40 * GIB * 10)).toBe(100);
  });

  it('clamps to the maximum (256) at or above 1 TiB', () => {
    expect(computeRegionCount(TIB)).toBe(SORTEDNESS_MAX_REGIONS);
    expect(computeRegionCount(10 * TIB)).toBe(SORTEDNESS_MAX_REGIONS);
  });

  it('never returns fewer than min or more than max for arbitrary sizes', () => {
    [
      GIB,
      GIB + 1,
      3 * GIB,
      999,
      5 * TIB,
    ].forEach((size) => {
      const n = computeRegionCount(size);
      expect(n).toBeGreaterThanOrEqual(SORTEDNESS_MIN_REGIONS);
      expect(n).toBeLessThanOrEqual(SORTEDNESS_MAX_REGIONS);
    });
  });

  it('keeps the derived region-read budget bounded by MAX * region bytes (SC-004)', () => {
    // Total sampled bytes = N * 4096 plus the two head/tail windows (2 * 8000).
    const headTailBytes = 2 * 8000;
    const maxBudget = SORTEDNESS_MAX_REGIONS * SORTEDNESS_REGION_READ_BYTES + headTailBytes;
    [
      GIB,
      89 * GIB,
      500 * GIB,
      TIB,
      10 * TIB,
    ].forEach((size) => {
      const n = computeRegionCount(size);
      const budget = n * SORTEDNESS_REGION_READ_BYTES + headTailBytes;
      expect(budget).toBeLessThanOrEqual(maxBudget);
    });
  });
});

describe('computeSampleOffsets', () => {
  it('returns count evenly spaced offsets with first offset 0', () => {
    const fileSize = 1000;
    const offsets = computeSampleOffsets(fileSize, 10);
    expect(offsets).toHaveLength(10);
    expect(offsets[0]).toBe(0);
    expect(offsets).toEqual([
      0,
      100,
      200,
      300,
      400,
      500,
      600,
      700,
      800,
      900,
    ]);
  });

  it('uses floor(i * fileSize / N)', () => {
    const fileSize = 1000;
    const n = 7;
    const offsets = computeSampleOffsets(fileSize, n);
    for (let i = 0; i < n; i += 1) {
      expect(offsets[i]).toBe(Math.floor((i * fileSize) / n));
    }
  });

  it('is deterministic: identical output across repeated calls', () => {
    const fileSize = 89 * 1024 * GIB;
    const count = SORTEDNESS_MAX_REGIONS;
    const first = computeSampleOffsets(fileSize, count);
    for (let run = 0; run < 5; run += 1) {
      expect(computeSampleOffsets(fileSize, count)).toEqual(first);
    }
  });

  it('returns monotonically non-decreasing offsets', () => {
    const offsets = computeSampleOffsets(123456789, 20);
    for (let i = 1; i < offsets.length; i += 1) {
      expect(offsets[i]).toBeGreaterThanOrEqual(offsets[i - 1]);
    }
  });

  it('throws on a non-positive count', () => {
    expect(() => computeSampleOffsets(1000, 0)).toThrow(/count/);
    expect(() => computeSampleOffsets(1000, -1)).toThrow(/count/);
  });
});

describe('assertNonOverlapInvariant', () => {
  it('passes when fileSize >= N * max(regionRead, maxLine)', () => {
    const minSpacing = Math.max(SORTEDNESS_REGION_READ_BYTES, MAX_LINE_BYTES);
    expect(() => assertNonOverlapInvariant(20 * minSpacing, 20)).not.toThrow();
    expect(() => assertNonOverlapInvariant(GIB, computeRegionCount(GIB))).not.toThrow();
  });

  it('throws an explicit error naming the invariant on violation', () => {
    const minSpacing = Math.max(SORTEDNESS_REGION_READ_BYTES, MAX_LINE_BYTES);
    expect(() => assertNonOverlapInvariant(20 * minSpacing - 1, 20))
      .toThrow(/non-overlap invariant violated/);
    expect(() => assertNonOverlapInvariant(100, SORTEDNESS_MAX_REGIONS))
      .toThrow(/non-overlap invariant violated/);
  });
});

describe('checkAlignedWindowSorted', () => {
  const hash = (n: number) => n.toString(16).padStart(40, '0');

  it('ignores a long partial first-line fragment that would yield a bogus hash', () => {
    // A genuinely sorted run, but the window starts 30 bytes into the first line,
    // leaving a 12-char fragment of it plus a full line.
    const full = `${hash(1)}:1\n${hash(2)}:1\n${hash(3)}:1\n`;
    const window = Buffer.from(full.slice(30), 'ascii');
    expect(checkAlignedWindowSorted(window, 40)).toBe(true);
  });

  it('detects an inversion among complete lines', () => {
    const body = `${hash(5)}:1\n${hash(4)}:1\n`;
    const window = Buffer.from(`partial\n${body}`, 'ascii');
    expect(checkAlignedWindowSorted(window, 40)).toBe(false);
  });

  it('returns true when the window has no complete line', () => {
    expect(checkAlignedWindowSorted(Buffer.from('no newline here', 'ascii'), 40)).toBe(true);
  });
});

describe('checkBufferSorted (UTF-8 BOM tolerance)', () => {
  const hash = (n: number) => n.toString(16).padStart(40, '0');
  const BOM = Buffer.from([
    0xef,
    0xbb,
    0xbf,
  ]);

  it('treats a corpus with a leading UTF-8 BOM as sorted', () => {
    const body = Buffer.from(`${hash(1)}:1\n${hash(2)}:1\n${hash(3)}:1\n`, 'ascii');
    expect(checkBufferSorted(Buffer.concat([BOM, body]), 40)).toBe(true);
  });

  it('still detects an inversion after a leading UTF-8 BOM', () => {
    const body = Buffer.from(`${hash(5)}:1\n${hash(4)}:1\n`, 'ascii');
    expect(checkBufferSorted(Buffer.concat([BOM, body]), 40)).toBe(false);
  });

  it('detects an inversion between a BOM-prefixed first line and the next line', () => {
    const body = Buffer.from(`${hash(9)}:1\n${hash(1)}:1\n`, 'ascii');
    expect(checkBufferSorted(Buffer.concat([BOM, body]), 40)).toBe(false);
  });

  it('is unaffected when no BOM is present', () => {
    expect(checkBufferSorted(Buffer.from(`${hash(1)}:1\n${hash(2)}:1\n`, 'ascii'), 40)).toBe(true);
    expect(checkBufferSorted(Buffer.from(`${hash(2)}:1\n${hash(1)}:1\n`, 'ascii'), 40)).toBe(false);
  });
});
