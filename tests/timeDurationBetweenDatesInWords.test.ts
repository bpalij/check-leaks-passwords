import timeDurationBetweenDatesInWords from '../src/helpers/timeDurationBetweenDatesInWords';

describe('timeDurationBetweenDatesInWords', () => {
  it('returns empty string for zero difference', () => {
    const d = new Date();
    expect(timeDurationBetweenDatesInWords(d, d)).toBe('');
  });

  it('shows seconds for small differences', () => {
    const d1 = new Date('2020-01-01T00:00:00.000Z');
    const d2 = new Date('2020-01-01T00:00:05.123Z');
    const result = timeDurationBetweenDatesInWords(d1, d2);
    expect(result).toContain('5 seconds');
    expect(result).toContain('123 ms');
  });

  it('shows minutes and seconds', () => {
    const d1 = new Date('2020-01-01T00:00:00.000Z');
    const d2 = new Date('2020-01-01T00:02:30.000Z');
    const result = timeDurationBetweenDatesInWords(d1, d2);
    expect(result).toContain('2 minutes');
    expect(result).toContain('30 seconds');
  });

  it('shows hours', () => {
    const d1 = new Date('2020-01-01T00:00:00.000Z');
    const d2 = new Date('2020-01-01T03:15:00.000Z');
    const result = timeDurationBetweenDatesInWords(d1, d2);
    expect(result).toContain('3 hours');
    expect(result).toContain('15 minutes');
  });

  it('shows days', () => {
    const d1 = new Date('2020-01-01T00:00:00.000Z');
    const d2 = new Date('2020-01-03T12:30:00.000Z');
    const result = timeDurationBetweenDatesInWords(d1, d2);
    expect(result).toContain('2 days');
    expect(result).toContain('12 hours');
    expect(result).toContain('30 minutes');
  });

  it('handles negative difference (uses absolute)', () => {
    const d1 = new Date('2020-01-02T00:00:00.000Z');
    const d2 = new Date('2020-01-01T00:00:00.000Z');
    const result = timeDurationBetweenDatesInWords(d1, d2);
    expect(result).toContain('1 days');
  });
});
