import timeDurationBetweenDatesInWords from '../src/helpers/timeDurationBetweenDatesInWords';

describe('timeDurationBetweenDatesInWords', () => {
  it('returns 0ms for zero difference', () => {
    const d = new Date();
    expect(timeDurationBetweenDatesInWords(d, d)).toBe('0ms');
  });

  it('shows seconds for small differences', () => {
    const d1 = new Date('2020-01-01T00:00:00.000Z');
    const d2 = new Date('2020-01-01T00:00:05.123Z');
    const result = timeDurationBetweenDatesInWords(d1, d2);
    expect(result).toContain('5sec');
    expect(result).toContain('123ms');
  });

  it('shows minutes and seconds', () => {
    const d1 = new Date('2020-01-01T00:00:00.000Z');
    const d2 = new Date('2020-01-01T00:02:30.000Z');
    const result = timeDurationBetweenDatesInWords(d1, d2);
    expect(result).toContain('2min');
    expect(result).toContain('30sec');
  });

  it('shows hours', () => {
    const d1 = new Date('2020-01-01T00:00:00.000Z');
    const d2 = new Date('2020-01-01T03:15:00.000Z');
    const result = timeDurationBetweenDatesInWords(d1, d2);
    expect(result).toContain('3h');
    expect(result).toContain('15min');
  });

  it('shows days', () => {
    const d1 = new Date('2020-01-01T00:00:00.000Z');
    const d2 = new Date('2020-01-03T12:30:00.000Z');
    const result = timeDurationBetweenDatesInWords(d1, d2);
    expect(result).toContain('2d');
    expect(result).toContain('12h');
    expect(result).toContain('30min');
  });

  it('handles negative difference (uses absolute)', () => {
    const d1 = new Date('2020-01-02T00:00:00.000Z');
    const d2 = new Date('2020-01-01T00:00:00.000Z');
    const result = timeDurationBetweenDatesInWords(d1, d2);
    expect(result).toContain('1d');
  });
});
