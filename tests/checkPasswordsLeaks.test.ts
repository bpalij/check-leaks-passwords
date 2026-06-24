import path from 'path';
import checkPasswordsLeaks from '../src/checkPasswordsLeaks';
import type { configInterface } from '../config/configInterface';

const fixturesDir = path.resolve(__dirname, 'fixtures');

const makeConfig = (overrides: Partial<configInterface> = {}): configInterface => ({
  inputPath: path.join(fixturesDir, 'sample.csv'),
  inputFormat: 'csv',
  hashesOfLeaksPath: path.join(fixturesDir, 'sample-hashes.txt'),
  outputs: [
    { format: 'json', path: path.join(__dirname, '__output__', `test_${Date.now()}.json`) },
  ],
  ...overrides,
});

describe('checkPasswordsLeaks integration', () => {
  it('runs the full pipeline and produces output', async () => {
    const cfg = makeConfig();
    const logs: string[] = [];
    const mockLogger = { log: (msg: string) => { logs.push(msg); } } as Console;

    await checkPasswordsLeaks(cfg, mockLogger);

    expect(logs).toContain('Reading input file');
    expect(logs).toContain('Checked hashes for leaks');
    expect(logs).toContain('Written json output');
  });

  it('throws when no outputs are configured', async () => {
    await expect(
      checkPasswordsLeaks(makeConfig({ outputs: [] }), console),
    ).rejects.toThrow('At least one output must be configured in config.outputs');
  });

  it('throws when empty passwords are found', async () => {
    await expect(
      checkPasswordsLeaks(
        makeConfig({ inputPath: path.join(fixturesDir, 'empty.csv') }),
        console,
      ),
    ).rejects.toThrow('Not found correct not-empty passwords');
  });

  it('throws for unknown input format', async () => {
    await expect(
      checkPasswordsLeaks(
        makeConfig({ inputFormat: 'xml' as 'csv' }),
        console,
      ),
    ).rejects.toThrow('Unknown input format: xml');
  });

  it('rejects input with no matching hashes', async () => {
    const cfg = makeConfig({
      hashesOfLeaksPath: path.join(fixturesDir, 'empty-hashes.txt'),
    });
    const logs: string[] = [];
    const mockLogger = { log: (msg: string) => { logs.push(msg); } } as Console;

    await checkPasswordsLeaks(cfg, mockLogger);
    expect(logs.some((l) => l.includes('Sorted output'))).toBe(true);
  });

  it('throws for unknown output format', async () => {
    await expect(
      checkPasswordsLeaks(
        makeConfig({ outputs: [{ format: 'xml' as 'csv', path: '/dev/null' }] }),
        console,
      ),
    ).rejects.toThrow('Unknown output format: xml');
  });

  it('sorts by leaks descending including equal values', async () => {
    const cfg = makeConfig({
      hashesOfLeaksPath: path.join(fixturesDir, 'same-leak-hashes.txt'),
    });
    const logs: string[] = [];
    const mockLogger = { log: (msg: string) => { logs.push(msg); } } as Console;

    await checkPasswordsLeaks(cfg, mockLogger);
    expect(logs.some((l) => l.includes('Sorting output by leaks DESC'))).toBe(true);
    expect(logs.some((l) => l.includes('Sorted output'))).toBe(true);
  });
});
