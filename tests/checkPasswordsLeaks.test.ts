import path from 'path';
import fs from 'fs';
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
  it('runs the full pipeline with CSV input and multiple outputs', async () => {
    const jsonPath = path.join(__dirname, '__output__', `csv-pipeline-${Date.now()}.json`);
    const csvPath = path.join(__dirname, '__output__', `csv-pipeline-${Date.now()}.csv`);
    const cfg: configInterface = {
      inputPath: path.join(fixturesDir, 'sample.csv'),
      inputFormat: 'csv',
      hashesOfLeaksPath: path.join(fixturesDir, 'sample-hashes.txt'),
      outputs: [
        { format: 'json', path: jsonPath },
        { format: 'csv', path: csvPath },
      ],
    };
    const logs: string[] = [];
    const mockLogger = { log: (msg: string) => { logs.push(msg); } } as Console;

    await checkPasswordsLeaks(cfg, mockLogger);

    expect(logs).toContain('Reading input file');
    expect(logs).toContain('Checked hashes for leaks');
    expect(logs).toContain('Written json output');
    expect(logs).toContain('Written csv output');

    const jsonOutput = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(jsonOutput).toHaveLength(3);
    expect(jsonOutput[0].leaks).toBe(1000);
    expect(jsonOutput[0].passwordObjects[0].login_password).toBe('password123');
    expect(jsonOutput[1].leaks).toBe(500);
    expect(jsonOutput[1].passwordObjects[0].login_password).toBe('letmein');
    expect(jsonOutput[2].leaks).toBe(250);
    expect(jsonOutput[2].passwordObjects[0].login_password).toBe('P@ssw0rd!');

    const csvOutput = fs.readFileSync(csvPath, 'utf-8');
    expect(csvOutput).toContain('password123');
    expect(csvOutput).toContain('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    expect(csvOutput).toContain('1 000');
    expect(csvOutput).toContain('letmein');
    expect(csvOutput).toContain('P@ssw0rd!');

    try { fs.unlinkSync(jsonPath); } catch { /* ignore */ }
    try { fs.unlinkSync(csvPath); } catch { /* ignore */ }
  });

  it('runs the full pipeline with JSON input and multiple outputs', async () => {
    const jsonPath = path.join(__dirname, '__output__', `json-pipeline-${Date.now()}.json`);
    const csvPath = path.join(__dirname, '__output__', `json-pipeline-${Date.now()}.csv`);
    const cfg: configInterface = {
      inputPath: path.join(fixturesDir, 'sample.json'),
      inputFormat: 'json',
      hashesOfLeaksPath: path.join(fixturesDir, 'sample-hashes.txt'),
      outputs: [
        { format: 'json', path: jsonPath },
        { format: 'csv', path: csvPath },
      ],
    };
    const logs: string[] = [];
    const mockLogger = { log: (msg: string) => { logs.push(msg); } } as Console;

    await checkPasswordsLeaks(cfg, mockLogger);

    expect(logs).toContain('Reading input file');
    expect(logs).toContain('Written json output');
    expect(logs).toContain('Written csv output');

    const jsonOutput = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(jsonOutput).toHaveLength(2);
    expect(jsonOutput[0].leaks).toBe(1000);
    expect(jsonOutput[0].passwordObjects[0].login_password).toBe('password123');
    expect(jsonOutput[0].passwordObjects[0].folder).toBe('Social');
    expect(jsonOutput[0].passwordObjects[0].login_uris).toEqual(['https://example.com']);
    expect(jsonOutput[1].leaks).toBe(500);
    expect(jsonOutput[1].passwordObjects[0].login_password).toBe('letmein');
    expect(jsonOutput[1].passwordObjects[0].folder).toBe('Work');

    const csvOutput = fs.readFileSync(csvPath, 'utf-8');
    expect(csvOutput).toContain('password123');
    expect(csvOutput).toContain('Social');
    expect(csvOutput).toContain('https://example.com');
    expect(csvOutput).toContain('letmein');
    expect(csvOutput).toContain('Work');

    try { fs.unlinkSync(jsonPath); } catch { /* ignore */ }
    try { fs.unlinkSync(csvPath); } catch { /* ignore */ }
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
    const outputPath = path.join(__dirname, '__output__', `sort-same-leaks-${Date.now()}.json`);
    const cfg = makeConfig({
      hashesOfLeaksPath: path.join(fixturesDir, 'same-leak-hashes.txt'),
      outputs: [{ format: 'json', path: outputPath }],
    });
    const logs: string[] = [];
    const mockLogger = { log: (msg: string) => { logs.push(msg); } } as Console;

    await checkPasswordsLeaks(cfg, mockLogger);

    expect(logs.some((l) => l.includes('Sorted output'))).toBe(true);

    const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8')) as Array<{ leaks: number; hash: string }>;
    expect(output).toHaveLength(3);
    for (let i = 1; i < output.length; i++) {
      expect(output[i - 1].leaks).toBeGreaterThanOrEqual(output[i].leaks);
    }
    const equalLeaks = output.filter((e) => e.leaks === 500);
    expect(equalLeaks).toHaveLength(2);

    try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
  });
});
