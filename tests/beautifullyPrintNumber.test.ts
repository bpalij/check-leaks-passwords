import beautifullyPrintNumber from '../src/helpers/beautifullyPrintNumber';

describe('beautifullyPrintNumber', () => {
  it('formats zero', () => {
    expect(beautifullyPrintNumber(0)).toBe('0');
  });

  it('formats small numbers without separator', () => {
    expect(beautifullyPrintNumber(1)).toBe('1');
    expect(beautifullyPrintNumber(999)).toBe('999');
  });

  it('formats thousands with space separator', () => {
    expect(beautifullyPrintNumber(1000)).toBe('1 000');
    expect(beautifullyPrintNumber(1234567)).toBe('1 234 567');
  });

  it('formats numbers with decimal part', () => {
    expect(beautifullyPrintNumber(1.5)).toBe('1.5');
    expect(beautifullyPrintNumber(1000.75)).toBe('1 000.75');
  });

  it('handles Infinity', () => {
    expect(beautifullyPrintNumber(Infinity)).toBe('Infinity');
    expect(beautifullyPrintNumber(-Infinity)).toBe('-Infinity');
  });

  it('handles negative numbers', () => {
    expect(beautifullyPrintNumber(-1000)).toBe('-1 000');
  });
});
