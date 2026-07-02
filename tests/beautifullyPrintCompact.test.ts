import beautifullyPrintCompact from '../src/helpers/beautifullyPrintCompact';

describe('beautifullyPrintCompact', () => {
  it('formats numbers below 1000', () => {
    expect(beautifullyPrintCompact(0)).toBe('0');
    expect(beautifullyPrintCompact(999)).toBe('999');
  });

  it('formats thousands with K suffix', () => {
    expect(beautifullyPrintCompact(1_000)).toBe('1 K');
    expect(beautifullyPrintCompact(1_500)).toBe('1.5 K');
    expect(beautifullyPrintCompact(10_000)).toBe('10 K');
    expect(beautifullyPrintCompact(12_500)).toBe('12.5 K');
    expect(beautifullyPrintCompact(999_900)).toBe('999.9 K');
  });

  it('formats millions with M suffix', () => {
    expect(beautifullyPrintCompact(1_000_000)).toBe('1 M');
    expect(beautifullyPrintCompact(1_500_000)).toBe('1.5 M');
    expect(beautifullyPrintCompact(15_000_000)).toBe('15 M');
    expect(beautifullyPrintCompact(825_341_567)).toBe('825.34 M');
    expect(beautifullyPrintCompact(999_000_000)).toBe('999 M');
  });

  it('formats billions with B suffix', () => {
    expect(beautifullyPrintCompact(1_000_000_000)).toBe('1 B');
    expect(beautifullyPrintCompact(1_230_000_000)).toBe('1.23 B');
    expect(beautifullyPrintCompact(12_500_000_000)).toBe('12.5 B');
    expect(beautifullyPrintCompact(150_000_000_000)).toBe('150 B');
    expect(beautifullyPrintCompact(1_000_000_000_000)).toBe('1000 B');
  });
});
