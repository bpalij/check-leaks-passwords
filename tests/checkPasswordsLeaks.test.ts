import path from 'path';
import fs from 'fs';
import checkPasswordsLeaks from '../src/checkPasswordsLeaks';
import type { configInterface } from '../config/configInterface';

const fixturesDir = path.resolve(__dirname, 'fixtures');

const makeConfig = (overrides: Partial<configInterface> = {}): configInterface => ({
  inputPath: path.join(fixturesDir, 'sample.csv'),
  inputFormat: 'csv',
  hashesOfLeaksPath: path.join(fixturesDir, 'sample-hashes.txt'),
  countLinesInHashesFile: false,
  useHibpApi: false,
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
      countLinesInHashesFile: false,
      useHibpApi: false,
      outputs: [
        { format: 'json', path: jsonPath },
        { format: 'csv', path: csvPath },
      ],
    };
    const logs: string[] = [];
    const mockLogger = { log: (msg: string) => { logs.push(msg); } } as Console;

    await checkPasswordsLeaks(cfg, mockLogger);
    expect(logs.some((l) => l.includes('Reading input file'))).toBe(true);
    expect(logs.some((l) => l.includes('Checked hashes for leaks'))).toBe(true);
    expect(logs.some((l) => l.includes('Written json output'))).toBe(true);
    expect(logs.some((l) => l.includes('Written csv output'))).toBe(true);

    const jsonOutput = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(jsonOutput).toHaveLength(3);
    expect(jsonOutput[0].leaks).toBe(1000);
    expect(jsonOutput[0].passwordObjects[0].login_password).toBe('password123');
    expect(jsonOutput[0].passwordObjects[0].login_password_hash).toBe('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    expect(jsonOutput[0].passwordObjects[0].login_password_leaks).toBe(1000);
    expect(jsonOutput[0].passwordObjects[0].login_password_readable_leaks).toBe('1 000');
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
      countLinesInHashesFile: false,
      useHibpApi: false,
      outputs: [
        { format: 'json', path: jsonPath },
        { format: 'csv', path: csvPath },
      ],
    };
    const logs: string[] = [];
    const mockLogger = { log: (msg: string) => { logs.push(msg); } } as Console;

    await checkPasswordsLeaks(cfg, mockLogger);

    expect(logs.some((l) => l.includes('Reading input file'))).toBe(true);
    expect(logs.some((l) => l.includes('Written json output'))).toBe(true);
    expect(logs.some((l) => l.includes('Written csv output'))).toBe(true);

    const jsonOutput = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(jsonOutput).toHaveLength(2);
    expect(jsonOutput[0].leaks).toBe(1000);
    expect(jsonOutput[0].passwordObjects[0].login.password).toBe('password123');
    expect(jsonOutput[0].passwordObjects[0].login_password_hash).toBe('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    expect(jsonOutput[0].passwordObjects[0].login_password_leaks).toBe(1000);
    expect(jsonOutput[0].passwordObjects[0].login_password_readable_leaks).toBe('1 000');
    expect(jsonOutput[0].passwordObjects[0].folderName).toBe('Social');
    expect(jsonOutput[0].passwordObjects[0].login.uris).toEqual([{ uri: 'https://example.com' }]);
    expect(jsonOutput[1].leaks).toBe(500);
    expect(jsonOutput[1].passwordObjects[0].login.password).toBe('letmein');
    expect(jsonOutput[1].passwordObjects[0].folderName).toBe('Work');

    const csvOutput = fs.readFileSync(csvPath, 'utf-8');
    expect(csvOutput).toContain('password123');
    expect(csvOutput).toContain('folderName');
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
    ).rejects.toThrow('Unknown inputFormat "xml"');
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
    ).rejects.toThrow('outputs[0].format "xml" is invalid');
  });

  it('sorts ascending input data in descending order', async () => {
    const outputPath = path.join(__dirname, '__output__', `sort-ascending-${Date.now()}.json`);
    const cfg = makeConfig({
      hashesOfLeaksPath: path.join(fixturesDir, 'ascending-leak-hashes.txt'),
      outputs: [{ format: 'json', path: outputPath }],
    });
    const logs: string[] = [];
    const mockLogger = { log: (msg: string) => { logs.push(msg); } } as Console;

    await checkPasswordsLeaks(cfg, mockLogger);

    expect(logs.some((l) => l.includes('Sorted output'))).toBe(true);

    const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    expect(output).toHaveLength(3);
    expect(output[0].leaks).toBe(1000);
    expect(output[1].leaks).toBe(500);
    expect(output[2].leaks).toBe(250);

    try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
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
    for (let i = 1; i < output.length; i += 1) {
      expect(output[i - 1].leaks).toBeGreaterThanOrEqual(output[i].leaks);
    }
    const equalLeaks = output.filter((e) => e.leaks === 500);
    expect(equalLeaks).toHaveLength(2);

    try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
  });

  it('runs with countLinesInHashesFile enabled', async () => {
    const cfg = makeConfig({ countLinesInHashesFile: true });
    const logs: string[] = [];
    const mockLogger = { log: (msg: string) => { logs.push(msg); } } as Console;

    await checkPasswordsLeaks(cfg, mockLogger);

    expect(logs.some((l) => l.includes('Counted'))).toBe(true);
    expect(logs.some((l) => l.includes('Checked hashes for leaks'))).toBe(true);
  });

  it('runs full pipeline with split hash directory and CSV input', async () => {
    const jsonPath = path.join(__dirname, '__output__', `split-csv-${Date.now()}.json`);
    const csvPath = path.join(__dirname, '__output__', `split-csv-${Date.now()}.csv`);
    const cfg: configInterface = {
      inputPath: path.join(fixturesDir, 'sample.csv'),
      inputFormat: 'csv',
      hashesOfLeaksPath: path.join(fixturesDir, 'split-hashes'),
      countLinesInHashesFile: true,
      useHibpApi: false,
      outputs: [
        { format: 'json', path: jsonPath },
        { format: 'csv', path: csvPath },
      ],
    };
    const logs: string[] = [];
    const mockLogger = { log: (msg: string) => { logs.push(msg); } } as Console;

    await checkPasswordsLeaks(cfg, mockLogger);

    expect(logs.some((l) => l.includes('Reading input file'))).toBe(true);
    expect(logs.some((l) => l.includes('Skipped line counting for split hash directory'))).toBe(true);
    expect(logs.some((l) => l.includes('Checked hashes for leaks'))).toBe(true);
    expect(logs.some((l) => l.includes('Written json output'))).toBe(true);
    expect(logs.some((l) => l.includes('Written csv output'))).toBe(true);

    const jsonOutput = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(jsonOutput).toHaveLength(3);
    expect(jsonOutput[0].leaks).toBe(1000);
    expect(jsonOutput[0].passwordObjects[0].login_password).toBe('password123');
    expect(jsonOutput[0].passwordObjects[0].login_password_hash).toBe('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    expect(jsonOutput[0].passwordObjects[0].login_password_leaks).toBe(1000);
    expect(jsonOutput[0].passwordObjects[0].login_password_readable_leaks).toBe('1 000');
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

  it('runs full pipeline with split hash directory and JSON input', async () => {
    const jsonPath = path.join(__dirname, '__output__', `split-json-${Date.now()}.json`);
    const csvPath = path.join(__dirname, '__output__', `split-json-${Date.now()}.csv`);
    const cfg: configInterface = {
      inputPath: path.join(fixturesDir, 'sample.json'),
      inputFormat: 'json',
      hashesOfLeaksPath: path.join(fixturesDir, 'split-hashes'),
      countLinesInHashesFile: true,
      useHibpApi: false,
      outputs: [
        { format: 'json', path: jsonPath },
        { format: 'csv', path: csvPath },
      ],
    };
    const logs: string[] = [];
    const mockLogger = { log: (msg: string) => { logs.push(msg); } } as Console;

    await checkPasswordsLeaks(cfg, mockLogger);

    expect(logs.some((l) => l.includes('Reading input file'))).toBe(true);
    expect(logs.some((l) => l.includes('Skipped line counting for split hash directory'))).toBe(true);
    expect(logs.some((l) => l.includes('Checked hashes for leaks'))).toBe(true);
    expect(logs.some((l) => l.includes('Written json output'))).toBe(true);
    expect(logs.some((l) => l.includes('Written csv output'))).toBe(true);

    const jsonOutput = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(jsonOutput).toHaveLength(2);
    expect(jsonOutput[0].leaks).toBe(1000);
    expect(jsonOutput[0].passwordObjects[0].login.password).toBe('password123');
    expect(jsonOutput[0].passwordObjects[0].login_password_hash).toBe('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    expect(jsonOutput[0].passwordObjects[0].login_password_leaks).toBe(1000);
    expect(jsonOutput[0].passwordObjects[0].login_password_readable_leaks).toBe('1 000');
    expect(jsonOutput[0].passwordObjects[0].folderName).toBe('Social');
    expect(jsonOutput[0].passwordObjects[0].login.uris).toEqual([{ uri: 'https://example.com' }]);
    expect(jsonOutput[1].leaks).toBe(500);
    expect(jsonOutput[1].passwordObjects[0].login.password).toBe('letmein');
    expect(jsonOutput[1].passwordObjects[0].folderName).toBe('Work');

    const csvOutput = fs.readFileSync(csvPath, 'utf-8');
    expect(csvOutput).toContain('password123');
    expect(csvOutput).toContain('folderName');
    expect(csvOutput).toContain('Social');
    expect(csvOutput).toContain('https://example.com');
    expect(csvOutput).toContain('letmein');
    expect(csvOutput).toContain('Work');

    try { fs.unlinkSync(jsonPath); } catch { /* ignore */ }
    try { fs.unlinkSync(csvPath); } catch { /* ignore */ }
  });

  it('runs full pipeline via HIBP API with countLinesInHashesFile enabled', { timeout: 30000 }, async () => {
    const jsonPath = path.join(__dirname, '__output__', `hibp-count-${Date.now()}.json`);
    const cfg: configInterface = {
      inputPath: path.join(fixturesDir, 'sample.csv'),
      inputFormat: 'csv',
      hashesOfLeaksPath: '/dev/null',
      countLinesInHashesFile: true,
      useHibpApi: true,
      outputs: [
        { format: 'json', path: jsonPath },
      ],
    };
    const logs: string[] = [];
    const mockLogger = { log: (msg: string) => { logs.push(msg); } } as Console;

    await checkPasswordsLeaks(cfg, mockLogger);

    expect(logs.some((l) => l.includes('Skipped counting lines in hashes file because useHibpApi is enabled'))).toBe(true);
    expect(logs.some((l) => l.includes('Already checked'))).toBe(true);
    expect(logs.some((l) => l.includes('Written json output'))).toBe(true);

    const jsonOutput = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(jsonOutput).toHaveLength(3);
    jsonOutput.forEach((entry: { leaks: number }) => {
      expect(entry.leaks).toBeGreaterThan(0);
    });

    try { fs.unlinkSync(jsonPath); } catch { /* ignore */ }
  });

  it('runs full pipeline via HIBP API with CSV input', { timeout: 30000 }, async () => {
    const jsonPath = path.join(__dirname, '__output__', `hibp-${Date.now()}.json`);
    const cfg: configInterface = {
      inputPath: path.join(fixturesDir, 'sample.csv'),
      inputFormat: 'csv',
      hashesOfLeaksPath: '/dev/null',
      countLinesInHashesFile: false,
      useHibpApi: true,
      outputs: [
        { format: 'json', path: jsonPath },
      ],
    };
    const logs: string[] = [];
    const mockLogger = { log: (msg: string) => { logs.push(msg); } } as Console;

    await checkPasswordsLeaks(cfg, mockLogger);

    expect(logs.some((l) => l.includes('Reading input file'))).toBe(true);
    expect(logs.some((l) => l.includes('Already checked'))).toBe(true);
    expect(logs.some((l) => l.includes('Checked all'))).toBe(true);
    expect(logs.some((l) => l.includes('Cloudflare cache'))).toBe(true);
    expect(logs.some((l) => l.includes('Written json output'))).toBe(true);

    const jsonOutput = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(jsonOutput).toHaveLength(3);
    jsonOutput.forEach((entry: { leaks: number }) => {
      expect(entry.leaks).toBeGreaterThan(0);
    });
    expect(jsonOutput[0].passwordObjects[0].login_password).toBe('password123');
    expect(jsonOutput[1].passwordObjects[0].login_password).toBe('letmein');
    expect(jsonOutput[2].passwordObjects[0].login_password).toBe('P@ssw0rd!');

    try { fs.unlinkSync(jsonPath); } catch { /* ignore */ }
  });
});
