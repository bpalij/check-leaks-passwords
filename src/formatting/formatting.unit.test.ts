import { formatNumber } from './formatNumber.js';
import { stripTrailingZeros } from './stripTrailingZeros.js';
import { formatCompact } from './formatCompact.js';
import { formatBytes } from './formatBytes.js';
import { formatDuration } from './formatDuration.js';

describe('formatNumber', () => {
  it('formats zero', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('formats small numbers without separator', () => {
    expect(formatNumber(1)).toBe('1');
    expect(formatNumber(999)).toBe('999');
  });

  it('formats thousands with space separator', () => {
    expect(formatNumber(1000)).toBe('1 000');
    expect(formatNumber(1234567)).toBe('1 234 567');
  });

  it('formats numbers with decimal part', () => {
    expect(formatNumber(1.5)).toBe('1.5');
    expect(formatNumber(1000.75)).toBe('1 000.75');
  });

  it('handles Infinity', () => {
    expect(formatNumber(Infinity)).toBe('Infinity');
    expect(formatNumber(-Infinity)).toBe('-Infinity');
  });

  it('handles negative numbers', () => {
    expect(formatNumber(-1000)).toBe('-1 000');
  });
});

describe('stripTrailingZeros', () => {
  it('strips trailing zeros after decimal', () => {
    expect(stripTrailingZeros('1.50')).toBe('1.5');
  });

  it('strips all decimal zeros', () => {
    expect(stripTrailingZeros('1.00')).toBe('1');
  });

  it('strips single trailing zero', () => {
    expect(stripTrailingZeros('0.10')).toBe('0.1');
  });

  it('strips multiple trailing zeros', () => {
    expect(stripTrailingZeros('12.3400')).toBe('12.34');
  });

  it('strips zeros leaving whole number', () => {
    expect(stripTrailingZeros('100.00')).toBe('100');
  });

  it('handles zero with decimals', () => {
    expect(stripTrailingZeros('0.00')).toBe('0');
  });

  it('does not modify number without trailing zeros', () => {
    expect(stripTrailingZeros('3.14159')).toBe('3.14159');
  });

  it('handles integer string', () => {
    expect(stripTrailingZeros('42')).toBe('42');
  });

  it('handles bare zero', () => {
    expect(stripTrailingZeros('0')).toBe('0');
  });

  it('handles leading-dot format', () => {
    expect(stripTrailingZeros('.50')).toBe('.5');
  });

  it('handles single zero after decimal', () => {
    expect(stripTrailingZeros('1.0')).toBe('1');
  });

  it('preserves leading zeros in decimal', () => {
    expect(stripTrailingZeros('0.050')).toBe('0.05');
  });
});

describe('formatCompact', () => {
  it('formats numbers below 1000', () => {
    expect(formatCompact(0)).toBe('0');
    expect(formatCompact(999)).toBe('999');
  });

  it('formats thousands withK suffix', () => {
    expect(formatCompact(1_000)).toBe('1K');
    expect(formatCompact(1_500)).toBe('1.5K');
    expect(formatCompact(10_000)).toBe('10K');
    expect(formatCompact(12_500)).toBe('12.5K');
    expect(formatCompact(999_900)).toBe('999.9K');
  });

  it('formats millions withM suffix', () => {
    expect(formatCompact(1_000_000)).toBe('1M');
    expect(formatCompact(1_500_000)).toBe('1.5M');
    expect(formatCompact(15_000_000)).toBe('15M');
    expect(formatCompact(825_341_567)).toBe('825.3M');
    expect(formatCompact(999_000_000)).toBe('999M');
  });

  it('formats billions withB suffix', () => {
    expect(formatCompact(1_000_000_000)).toBe('1B');
    expect(formatCompact(1_230_000_000)).toBe('1.23B');
    expect(formatCompact(12_500_000_000)).toBe('12.5B');
    expect(formatCompact(150_000_000_000)).toBe('150B');
    expect(formatCompact(1_000_000_000_000)).toBe('1000B');
  });
});

describe('formatBytes', () => {
  it('formats zero bytes', () => {
    expect(formatBytes(0)).toBe('0B');
  });

  it('formats bytes without unit conversion', () => {
    expect(formatBytes(1)).toBe('1B');
    expect(formatBytes(1023)).toBe('1023B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1KB');
    expect(formatBytes(1_536)).toBe('1.5KB');
    expect(formatBytes(999_900)).toBe('976.5KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(1_048_576)).toBe('1MB');
    expect(formatBytes(1_572_864)).toBe('1.5MB');
    expect(formatBytes(10_485_760)).toBe('10MB');
    expect(formatBytes(104_857_600)).toBe('100MB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(1_073_741_824)).toBe('1GB');
    expect(formatBytes(10_737_418_240)).toBe('10GB');
    expect(formatBytes(107_374_182_400)).toBe('100GB');
  });

  it('formats terabytes', () => {
    expect(formatBytes(1_099_511_627_776)).toBe('1TB');
    expect(formatBytes(2_199_023_255_552)).toBe('2TB');
  });
});

describe('formatDuration', () => {
  it('returns 0ms for zero difference', () => {
    const d = Temporal.Now.instant();
    expect(formatDuration(d, d)).toBe('0ms');
  });

  it('shows seconds for small differences', () => {
    const i1 = Temporal.Instant.fromEpochMilliseconds(Date.UTC(2020, 0, 1, 0, 0, 0, 0));
    const i2 = Temporal.Instant.fromEpochMilliseconds(Date.UTC(2020, 0, 1, 0, 0, 5, 123));
    const result = formatDuration(i1, i2);
    expect(result).toContain('5sec');
    expect(result).toContain('123ms');
  });

  it('shows minutes and seconds', () => {
    const i1 = Temporal.Instant.fromEpochMilliseconds(Date.UTC(2020, 0, 1, 0, 0, 0, 0));
    const i2 = Temporal.Instant.fromEpochMilliseconds(Date.UTC(2020, 0, 1, 0, 2, 30, 0));
    const result = formatDuration(i1, i2);
    expect(result).toContain('2min');
    expect(result).toContain('30sec');
  });

  it('shows hours', () => {
    const i1 = Temporal.Instant.fromEpochMilliseconds(Date.UTC(2020, 0, 1, 0, 0, 0, 0));
    const i2 = Temporal.Instant.fromEpochMilliseconds(Date.UTC(2020, 0, 1, 3, 15, 0, 0));
    const result = formatDuration(i1, i2);
    expect(result).toContain('3h');
    expect(result).toContain('15min');
  });

  it('shows days', () => {
    const i1 = Temporal.Instant.fromEpochMilliseconds(Date.UTC(2020, 0, 1, 0, 0, 0, 0));
    const i2 = Temporal.Instant.fromEpochMilliseconds(Date.UTC(2020, 0, 3, 12, 30, 0, 0));
    const result = formatDuration(i1, i2);
    expect(result).toContain('2d');
    expect(result).toContain('12h');
    expect(result).toContain('30min');
  });

  it('handles negative difference (uses absolute)', () => {
    const i1 = Temporal.Instant.fromEpochMilliseconds(Date.UTC(2020, 0, 2, 0, 0, 0, 0));
    const i2 = Temporal.Instant.fromEpochMilliseconds(Date.UTC(2020, 0, 1, 0, 0, 0, 0));
    const result = formatDuration(i1, i2);
    expect(result).toContain('1d');
  });
});
