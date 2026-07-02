import beautifullyPrintBytes from '../src/helpers/beautifullyPrintBytes';

describe('beautifullyPrintBytes', () => {
  it('formats zero bytes', () => {
    expect(beautifullyPrintBytes(0)).toBe('0 bytes');
  });

  it('formats bytes without unit conversion', () => {
    expect(beautifullyPrintBytes(1)).toBe('1 byte');
    expect(beautifullyPrintBytes(1023)).toBe('1023 bytes');
  });

  it('formats kilobytes', () => {
    expect(beautifullyPrintBytes(1024)).toBe('1 KB');
    expect(beautifullyPrintBytes(1_536)).toBe('1.5 KB');
    expect(beautifullyPrintBytes(999_900)).toBe('976.46 KB');
  });

  it('formats megabytes', () => {
    expect(beautifullyPrintBytes(1_048_576)).toBe('1 MB');
    expect(beautifullyPrintBytes(1_572_864)).toBe('1.5 MB');
    expect(beautifullyPrintBytes(10_485_760)).toBe('10 MB');
    expect(beautifullyPrintBytes(104_857_600)).toBe('100 MB');
  });

  it('formats gigabytes', () => {
    expect(beautifullyPrintBytes(1_073_741_824)).toBe('1 GB');
    expect(beautifullyPrintBytes(10_737_418_240)).toBe('10 GB');
    expect(beautifullyPrintBytes(107_374_182_400)).toBe('100 GB');
    expect(beautifullyPrintBytes(1_073_741_824_000)).toBe('1000 GB');
  });
});
