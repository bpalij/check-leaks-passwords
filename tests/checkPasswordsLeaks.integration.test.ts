import path from 'path';
import fs from 'fs';
import os from 'os';
import { Readable } from 'stream';

import { vi } from 'vitest';

import { checkPasswordsLeaks } from '../src/checkPasswordsLeaks.js';
import * as determineOptimalChunkCountModule from '../src/memory/determineOptimalChunkCount.js';
import { generateEncryptedExport } from '../src/crypto/generateEncryptedExport.js';
import type { ConfigInterface } from '../src/types.js';
import { FIXTURES_DIR } from './helpers/fixturesDir.js';
import { sha1 } from './helpers/sha1.js';

vi.hoisted(() => {
  process.env.UV_THREADPOOL_SIZE = '42';
});

const fixturesDir = FIXTURES_DIR;

const makeConfig = (overrides: Partial<ConfigInterface> = {}): ConfigInterface => ({
  inputPath: path.join(fixturesDir, 'sample.csv'),
  hashesOfLeaksPath: path.join(fixturesDir, 'sample-hashes.txt'),
  useHibpApi: false,
  singleFileReadMode: 'auto',
  buildIndex: false,
  includeSecrets: true,
  outputs: [{ format: 'json', path: path.join(import.meta.dirname, '__output__', `test_${Date.now()}.json`) }],
  ...overrides,
});

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-int-'));
  return dir;
}

describe('checkPasswordsLeaks integration', () => {
  it('runs the full pipeline with CSV input and multiple outputs', async () => {
    const jsonPath = path.join(import.meta.dirname, '__output__', `csv-pipeline-${Date.now()}.json`);
    const csvPath = path.join(import.meta.dirname, '__output__', `csv-pipeline-${Date.now()}.csv`);
    const cfg: ConfigInterface = {
      inputPath: path.join(fixturesDir, 'sample.csv'),

      hashesOfLeaksPath: path.join(fixturesDir, 'sample-hashes.txt'),
      useHibpApi: false,
      singleFileReadMode: 'auto',
      buildIndex: false,
      includeSecrets: true,
      outputs: [{ format: 'json', path: jsonPath }, { format: 'csv', path: csvPath }],
    };

    try {
      await checkPasswordsLeaks(cfg);

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
    } finally {
      try { fs.unlinkSync(jsonPath); } catch { /* ignore */ }
      try { fs.unlinkSync(csvPath); } catch { /* ignore */ }
    }
  });

  it('runs the full pipeline with JSON input and multiple outputs', async () => {
    const jsonPath = path.join(import.meta.dirname, '__output__', `json-pipeline-${Date.now()}.json`);
    const csvPath = path.join(import.meta.dirname, '__output__', `json-pipeline-${Date.now()}.csv`);
    const cfg: ConfigInterface = {
      inputPath: path.join(fixturesDir, 'sample.json'),

      hashesOfLeaksPath: path.join(fixturesDir, 'sample-hashes.txt'),
      useHibpApi: false,
      singleFileReadMode: 'auto',
      buildIndex: false,
      includeSecrets: true,
      outputs: [{ format: 'json', path: jsonPath }, { format: 'csv', path: csvPath }],
    };

    try {
      await checkPasswordsLeaks(cfg);

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
    } finally {
      try { fs.unlinkSync(jsonPath); } catch { /* ignore */ }
      try { fs.unlinkSync(csvPath); } catch { /* ignore */ }
    }
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
    ).rejects.toThrow('No non-empty passwords found');
  });

  it('throws for account-restricted encrypted export', async () => {
    const encrypted = generateEncryptedExport(
      JSON.stringify({ items: [] }),
      'test-password',
      { kdfType: 0, iterations: 1000, salt: Buffer.alloc(16, 0) },
    );
    const modified = encrypted.replace('"passwordProtected":true', '"passwordProtected":false');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-accrestricted-'));
    const inputPath = path.join(tmpDir, 'encrypted.json');
    fs.writeFileSync(inputPath, modified, 'utf-8');

    try {
      await expect(
        checkPasswordsLeaks(
          makeConfig({ inputPath }),
          console,
        ),
      ).rejects.toThrow('account-restricted');
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('throws for encrypted export without password', async () => {
    const encrypted = generateEncryptedExport(
      JSON.stringify({ items: [] }),
      'test-password',
      { kdfType: 0, iterations: 1000, salt: Buffer.alloc(16, 0) },
    );
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-nopw-'));
    const inputPath = path.join(tmpDir, 'encrypted.json');
    fs.writeFileSync(inputPath, encrypted, 'utf-8');

    const originalStdin = process.stdin;
    const fakeStdin = new Readable({
      read() {
        this.push('\n');
        this.push('\u001b');
        this.push(null);
      },
    });
    fakeStdin.isTTY = true;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, writable: true });

    try {
      await expect(
        checkPasswordsLeaks(
          makeConfig({ inputPath }),
          console,
        ),
      ).rejects.toThrow();
    } finally {
      Object.defineProperty(process, 'stdin', { value: originalStdin, writable: true });
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('rejects input with no matching hashes', async () => {
    const outputPath = path.join(import.meta.dirname, '__output__', `no-matches-${Date.now()}.json`);
    const cfg = makeConfig({
      hashesOfLeaksPath: path.join(fixturesDir, 'empty-hashes.txt'),
      outputs: [{ format: 'json', path: outputPath }],
    });

    try {
      await checkPasswordsLeaks(cfg);
      const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      expect(output).toHaveLength(0);
    } finally {
      try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
    }
  });

  it('throws for unknown output format', async () => {
    await expect(
      checkPasswordsLeaks(
        makeConfig({ outputs: [{ format: 'xml' as 'csv', path: '/dev/null' }] }),
        console,
      ),
    ).rejects.toThrow('outputs[0].format "xml" is invalid');
  });

  it('throws for unknown output format handler when validateConfig is bypassed', async () => {
    vi.spyOn(await import('../src/validateConfig.js'), 'validateConfig').mockImplementation(() => undefined);

    await expect(
      checkPasswordsLeaks(
        makeConfig({ outputs: [{ format: 'xml', path: '/dev/null' }] }),
        console,
      ),
    ).rejects.toThrow('Unknown output format: xml');

    vi.restoreAllMocks();
  });

  it('sorts ascending input data in descending order', async () => {
    const outputPath = path.join(import.meta.dirname, '__output__', `sort-ascending-${Date.now()}.json`);
    const cfg = makeConfig({
      hashesOfLeaksPath: path.join(fixturesDir, 'ascending-leak-hashes.txt'),
      outputs: [{ format: 'json', path: outputPath }],
    });

    try {
      await checkPasswordsLeaks(cfg);

      const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      expect(output).toHaveLength(3);
      expect(output[0].leaks).toBe(1000);
      expect(output[1].leaks).toBe(500);
      expect(output[2].leaks).toBe(250);
    } finally {
      try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
    }
  });

  it('sorts by leaks descending including equal values', async () => {
    const outputPath = path.join(import.meta.dirname, '__output__', `sort-same-leaks-${Date.now()}.json`);
    const cfg = makeConfig({
      hashesOfLeaksPath: path.join(fixturesDir, 'same-leak-hashes.txt'),
      outputs: [{ format: 'json', path: outputPath }],
    });

    try {
      await checkPasswordsLeaks(cfg);

      const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8')) as Array<{ leaks: number; hash: string }>;
      expect(output).toHaveLength(3);
      for (let i = 1; i < output.length; i += 1) {
        expect(output[i - 1].leaks).toBeGreaterThanOrEqual(output[i].leaks);
      }
      const equalLeaks = output.filter((e) => e.leaks === 500);
      expect(equalLeaks).toHaveLength(2);
    } finally {
      try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
    }
  });

  it('runs full pipeline with split hash directory and CSV input', async () => {
    const jsonPath = path.join(import.meta.dirname, '__output__', `split-csv-${Date.now()}.json`);
    const csvPath = path.join(import.meta.dirname, '__output__', `split-csv-${Date.now()}.csv`);
    const cfg: ConfigInterface = {
      inputPath: path.join(fixturesDir, 'sample.csv'),

      hashesOfLeaksPath: path.join(fixturesDir, 'split-hashes'),
      useHibpApi: false,
      singleFileReadMode: 'auto',
      buildIndex: false,
      includeSecrets: true,
      outputs: [{ format: 'json', path: jsonPath }, { format: 'csv', path: csvPath }],
    };

    try {
      await checkPasswordsLeaks(cfg);

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
    } finally {
      try { fs.unlinkSync(jsonPath); } catch { /* ignore */ }
      try { fs.unlinkSync(csvPath); } catch { /* ignore */ }
    }
  });

  it('runs full pipeline with split hash directory and JSON input', async () => {
    const jsonPath = path.join(import.meta.dirname, '__output__', `split-json-${Date.now()}.json`);
    const csvPath = path.join(import.meta.dirname, '__output__', `split-json-${Date.now()}.csv`);
    const cfg: ConfigInterface = {
      inputPath: path.join(fixturesDir, 'sample.json'),

      hashesOfLeaksPath: path.join(fixturesDir, 'split-hashes'),
      useHibpApi: false,
      singleFileReadMode: 'auto',
      buildIndex: false,
      includeSecrets: true,
      outputs: [{ format: 'json', path: jsonPath }, { format: 'csv', path: csvPath }],
    };

    try {
      await checkPasswordsLeaks(cfg);

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
    } finally {
      try { fs.unlinkSync(jsonPath); } catch { /* ignore */ }
      try { fs.unlinkSync(csvPath); } catch { /* ignore */ }
    }
  });

  it('runs full pipeline with multi-chunk file processing', async () => {
    vi.spyOn(determineOptimalChunkCountModule, 'determineOptimalChunkCount')
      .mockResolvedValue({
        chunkCount: 2,
        isHDD: false,
        iopMBps: 500,
        preCheckSkipped: false,
        testDurationMs: 128,
        seekTimeMs: 0.05,
      });

    const outputPath = path.join(import.meta.dirname, '__output__', `multi-chunk-${Date.now()}.json`);
    const cfg = makeConfig({
      outputs: [{ format: 'json', path: outputPath }],
    });

    try {
      await checkPasswordsLeaks(cfg);

      const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      expect(output).toHaveLength(3);
      expect(output[0].leaks).toBe(1000);
      expect(output[0].passwordObjects[0].login_password).toBe('password123');
    } finally {
      try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
      vi.restoreAllMocks();
    }
  });

  it('runs full pipeline via HIBP API with CSV input', { timeout: 30000, skip: process.env.CI === 'true' }, async () => {
    const jsonPath = path.join(import.meta.dirname, '__output__', `hibp-${Date.now()}.json`);
    const cfg: ConfigInterface = {
      inputPath: path.join(fixturesDir, 'sample.csv'),

      hashesOfLeaksPath: '/dev/null',
      useHibpApi: true,
      singleFileReadMode: 'auto',
      buildIndex: false,
      includeSecrets: true,
      outputs: [{ format: 'json', path: jsonPath }],
    };

    try {
      await checkPasswordsLeaks(cfg);

      const jsonOutput = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      expect(jsonOutput).toHaveLength(3);
      jsonOutput.forEach((entry: { leaks: number }) => {
        expect(entry.leaks).toBeGreaterThan(0);
      });
      expect(jsonOutput[0].passwordObjects[0].login_password).toBe('password123');
      expect(jsonOutput[1].passwordObjects[0].login_password).toBe('letmein');
      expect(jsonOutput[2].passwordObjects[0].login_password).toBe('P@ssw0rd!');
    } finally {
      try { fs.unlinkSync(jsonPath); } catch { /* ignore */ }
    }
  });

  it('runs full pipeline with dynamically created input and hash files', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dynamic-'));
    const outputPath = path.join(import.meta.dirname, '__output__', `e2e-dynamic-${Date.now()}.json`);
    const csvPath = path.join(tmpDir, 'input.csv');
    const hashPath = path.join(tmpDir, 'hashes.txt');

    const matchingPasswords = [
      {
        pw: 'alpha123', username: 'u1', name: 'Site A', folder: 'Work', leaks: 500,
      },
      {
        pw: 'beta456', username: 'u2', name: 'Site B', folder: 'Personal', leaks: 1000,
      },
      {
        pw: 'gamma789', username: 'u3', name: 'Site C', folder: 'Work', leaks: 250,
      },
      {
        pw: 'delta000', username: 'u4', name: 'Site D', folder: 'Finance', leaks: 750,
      },
    ];
    const nonMatchingPasswords = [
      {
        pw: 'epsilon999', username: 'u5', name: 'Site E', folder: 'Other',
      },
      {
        pw: 'zeta888', username: 'u6', name: 'Site F', folder: 'Other',
      },
    ];

    const hashEntries = matchingPasswords.map(({ pw, leaks }) => {
      const hash = sha1(pw);
      return { hash, leaks, line: `${hash}:${leaks}` };
    });

    fs.writeFileSync(hashPath, `${hashEntries.map((e) => e.line).join('\n')}\n`, 'ascii');

    const csvLines = ['login_password,login_username,name,folder'];
    [...matchingPasswords, ...nonMatchingPasswords].forEach((p) => {
      csvLines.push(`${p.pw},${p.username},${p.name},${p.folder}`);
    });
    fs.writeFileSync(csvPath, `${csvLines.join('\n')}\n`, 'utf-8');

    try {
      await checkPasswordsLeaks({
        inputPath: csvPath,

        hashesOfLeaksPath: hashPath,
        useHibpApi: false,
        singleFileReadMode: 'auto',
        buildIndex: false,
        includeSecrets: true,
        outputs: [{ format: 'json', path: outputPath }],
      });

      const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      expect(output).toHaveLength(4);

      for (let i = 1; i < output.length; i += 1) {
        expect(output[i - 1].leaks).toBeGreaterThanOrEqual(output[i].leaks);
      }

      type OutputEntry = { passwordObjects: Array<{ login_password: string }> };
      const hasMatchingPw = (po: { login_password: string }, pw: string) => (
        po.login_password === pw
      );
      const findEntryByPw = (pw: string) => output.find(
        (e: OutputEntry) => e.passwordObjects.some((po) => hasMatchingPw(po, pw)),
      );

      matchingPasswords.forEach((mp) => {
        const entry = findEntryByPw(mp.pw);
        expect(entry).toBeDefined();
        const hashLookup = hashEntries.find((he) => he.hash === entry.hash);
        expect(hashLookup).toBeDefined();
        expect(entry.leaks).toBe(hashLookup!.leaks);
        expect(entry.passwordObjects[0].login_username).toBe(mp.username);
        expect(entry.passwordObjects[0].name).toBe(mp.name);
        expect(entry.passwordObjects[0].folder).toBe(mp.folder);
      });

      nonMatchingPasswords.forEach((np) => {
        expect(output.some(
          (e: OutputEntry) => e.passwordObjects.some((po) => hasMatchingPw(po, np.pw)),
        )).toBe(false);
      });
    } finally {
      try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('runs full pipeline with malformed hash file (invalid lines skipped)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-malformed-'));
    const outputPath = path.join(import.meta.dirname, '__output__', `e2e-malformed-${Date.now()}.json`);
    const csvPath = path.join(tmpDir, 'input.csv');
    const hashPath = path.join(tmpDir, 'hashes.txt');

    const validPasswords = [{ pw: 'validOne', leaks: 300, name: 'Valid One' }, { pw: 'validTwo', leaks: 800, name: 'Valid Two' }];
    const invalidPasswords = [
      { pw: 'badCount', name: 'Bad Count' },
      { pw: 'noColon', name: 'No Colon' },
      { pw: 'emptyLine', name: 'Empty Line' },
    ];

    const hashEntries = validPasswords.map(({ pw, leaks }) => {
      const hash = sha1(pw);
      return { hash, leaks, line: `${hash}:${leaks}` };
    });

    const badCountHash = sha1('badCount');
    const noColonHash = sha1('noColon');

    const hashLines = [
      ...hashEntries.map((e) => e.line),
      `${badCountHash}:abc`,
      `${noColonHash}`,
      '',
    ];
    fs.writeFileSync(hashPath, `${hashLines.join('\n')}\n`, 'ascii');

    const csvLines = ['login_password,login_username,name'];
    [...validPasswords, ...invalidPasswords].forEach((p) => {
      csvLines.push(`${p.pw},,${p.name}`);
    });
    fs.writeFileSync(csvPath, `${csvLines.join('\n')}\n`, 'utf-8');

    const logs: string[] = [];
    const mockLogger = { log: (msg: string) => { logs.push(msg); } } as Console;

    try {
      await checkPasswordsLeaks({
        inputPath: csvPath,

        hashesOfLeaksPath: hashPath,
        useHibpApi: false,
        singleFileReadMode: 'auto',
        buildIndex: false,
        includeSecrets: true,
        outputs: [{ format: 'json', path: outputPath }],
      }, mockLogger);

      const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      expect(output).toHaveLength(2);

      type OutputEntry = { passwordObjects: Array<{ login_password: string }> };
      const hasMatchingPw2 = (po: { login_password: string }, pw: string) => (
        po.login_password === pw
      );
      const findEntryByPw2 = (pw: string) => output.find(
        (e: OutputEntry) => e.passwordObjects.some((po) => hasMatchingPw2(po, pw)),
      );

      validPasswords.forEach((vp) => {
        const entry = findEntryByPw2(vp.pw);
        expect(entry).toBeDefined();
        const hashLookup = hashEntries.find((he) => he.hash === entry.hash);
        expect(hashLookup).toBeDefined();
        expect(entry.leaks).toBe(hashLookup!.leaks);
      });

      invalidPasswords.forEach((ip) => {
        expect(output.some(
          (e: OutputEntry) => e.passwordObjects.some((po) => hasMatchingPw2(po, ip.pw)),
        )).toBe(false);
      });
    } finally {
      try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('runs full pipeline with duplicate passwords in input', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dup-'));
    const outputPath = path.join(import.meta.dirname, '__output__', `e2e-dup-${Date.now()}.json`);
    const csvPath = path.join(tmpDir, 'input.csv');
    const hashPath = path.join(tmpDir, 'hashes.txt');

    const dupPassword = 'duplicateMe';
    const hash = sha1(dupPassword);
    const leaks = 600;

    fs.writeFileSync(hashPath, `${hash}:${leaks}\n`, 'ascii');

    const csvLines = [
      'login_password,login_username,name',
      `${dupPassword},alice,Alice Account`,
      `${dupPassword},bob,Bob Account`,
      `${dupPassword},carol,Carol Account`,
    ];
    fs.writeFileSync(csvPath, `${csvLines.join('\n')}\n`, 'utf-8');

    const logs: string[] = [];
    const mockLogger = { log: (msg: string) => { logs.push(msg); } } as Console;

    try {
      await checkPasswordsLeaks({
        inputPath: csvPath,

        hashesOfLeaksPath: hashPath,
        useHibpApi: false,
        singleFileReadMode: 'auto',
        buildIndex: false,
        includeSecrets: true,
        outputs: [{ format: 'json', path: outputPath }],
      }, mockLogger);

      const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      expect(output).toHaveLength(1);
      expect(output[0].hash).toBe(hash);
      expect(output[0].leaks).toBe(leaks);
      expect(output[0].passwordObjects).toHaveLength(3);
      expect(output[0].passwordObjects[0].login_password).toBe(dupPassword);
      expect(output[0].passwordObjects[0].login_username).toBe('alice');
      expect(output[0].passwordObjects[1].login_username).toBe('bob');
      expect(output[0].passwordObjects[2].login_username).toBe('carol');
    } finally {
      try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('throws for empty (headers-only) CSV input (no password rows)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-empty-'));
    const csvPath = path.join(tmpDir, 'input.csv');
    const hashPath = path.join(tmpDir, 'hashes.txt');

    fs.writeFileSync(hashPath, 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97:1000\n', 'ascii');
    fs.writeFileSync(csvPath, 'login_password,login_username,name\n', 'utf-8');

    try {
      await expect(
        checkPasswordsLeaks({
          inputPath: csvPath,

          hashesOfLeaksPath: hashPath,
          useHibpApi: false,
          singleFileReadMode: 'auto',
          buildIndex: false,
          includeSecrets: true,
          outputs: [{ format: 'json', path: path.join(tmpDir, 'out.json') }],
        }, console),
      ).rejects.toThrow('No non-empty passwords found');
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it.each([
    {
      label: 'runs full pipeline with encrypted JSON input and correct password',
      encryptPassword: 'test-password-123',
      exportPassword: 'test-password-123',
      useEnvVar: false,
      splitDir: false,
      dualOutput: false,
      expectError: null as string | null,
      expectedCount: 2,
      expectedPasswords: ['password123', 'letmein'],
      vaultFolders: [{ id: '1', name: 'Social' }],
      vaultItems: [
        {
          folderId: '1',
          type: 1,
          name: 'Example Site',
          login: {
            password: 'password123',
            username: 'user@example.com',
            uris: [{ uri: 'https://example.com', match: null }],
          },
        },
        {
          folderId: '1',
          type: 1,
          name: 'Work Site',
          login: {
            password: 'letmein',
            username: 'user@work.com',
            uris: null,
          },
        },
      ],
      hashEntries: [{ password: 'password123', leaks: 1000 }, { password: 'letmein', leaks: 500 }],
    },
    {
      label: 'throws for encrypted JSON with wrong password',
      encryptPassword: 'correct-password',
      exportPassword: 'wrong-password',
      useEnvVar: false,
      splitDir: false,
      dualOutput: false,
      expectError: 'Incorrect password',
      expectedCount: 0,
      expectedPasswords: [] as string[],
      vaultFolders: [],
      vaultItems: [
        {
          type: 1,
          name: 'Test',
          login: { password: 'pass123', username: 'user@test.com' },
        },
      ],
      hashEntries: [] as Array<{ password: string; leaks: number }>,
    },
    {
      label: 'uses env var for encrypted export password',
      encryptPassword: 'env-test-password',
      exportPassword: 'env-test-password',
      useEnvVar: true,
      splitDir: false,
      dualOutput: false,
      expectError: null as string | null,
      expectedCount: 1,
      expectedPasswords: ['envpass1'],
      vaultFolders: [],
      vaultItems: [
        {
          type: 1,
          name: 'Test',
          login: { password: 'envpass1', username: 'user@test.com' },
        },
      ],
      hashEntries: [{ password: 'envpass1', leaks: 999 }],
    },
    {
      label: 'runs full pipeline with encrypted JSON and split hash directory',
      encryptPassword: 'split-test-password',
      exportPassword: 'split-test-password',
      useEnvVar: false,
      splitDir: true,
      dualOutput: false,
      expectError: null as string | null,
      expectedCount: 1,
      expectedPasswords: ['splitpass'],
      vaultFolders: [],
      vaultItems: [
        {
          type: 1,
          name: 'Test',
          login: { password: 'splitpass', username: 'user@test.com' },
        },
      ],
      hashEntries: [{ password: 'splitpass', leaks: 777 }],
    },
    {
      label: 'runs full pipeline with encrypted JSON and dual output',
      encryptPassword: 'dual-test-password',
      exportPassword: 'dual-test-password',
      useEnvVar: false,
      splitDir: false,
      dualOutput: true,
      expectError: null as string | null,
      expectedCount: 1,
      expectedPasswords: ['dualpass'],
      vaultFolders: [],
      vaultItems: [
        {
          type: 1,
          name: 'Test',
          login: { password: 'dualpass', username: 'user@test.com' },
        },
      ],
      hashEntries: [{ password: 'dualpass', leaks: 333 }],
    },
  ])('$label', async ({
    encryptPassword,
    exportPassword,
    useEnvVar,
    splitDir,
    dualOutput,
    expectError,
    expectedCount,
    expectedPasswords,
    vaultFolders,
    vaultItems,
    hashEntries,
  }) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-encrypted-'));
    const inputPath = path.join(tmpDir, 'encrypted.json');
    const outputPath = path.join(tmpDir, 'output.json');

    const vault = {
      ...(vaultFolders.length > 0 ? { folders: vaultFolders } : {}),
      items: vaultItems,
    };

    let hashesOfLeaksPath: string;
    if (splitDir) {
      const splitHashDir = path.join(tmpDir, 'split-hashes');
      fs.mkdirSync(splitHashDir, { recursive: true });
      hashEntries.forEach(({ password: pw, leaks }) => {
        const hash = sha1(pw);
        const prefix = hash.slice(0, 5);
        const splitLine = `${hash.slice(5)}:${leaks}\n`;
        const splitFile = path.join(splitHashDir, `${prefix}.txt`);
        fs.writeFileSync(splitFile, splitLine, 'ascii');
      });
      hashesOfLeaksPath = splitHashDir;
    } else {
      const hashPath = path.join(tmpDir, 'hashes.txt');
      const lines = hashEntries.map(({ password: pw, leaks }) => {
        const hash = sha1(pw);
        return `${hash}:${leaks}`;
      });
      fs.writeFileSync(hashPath, `${lines.join('\n')}\n`, 'ascii');
      hashesOfLeaksPath = hashPath;
    }

    const encrypted = generateEncryptedExport(
      JSON.stringify(vault),
      encryptPassword,
      { kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0) },
    );
    fs.writeFileSync(inputPath, encrypted, 'utf-8');

    const outputs = dualOutput
      ? [{ format: 'json' as const, path: outputPath }, { format: 'csv' as const, path: path.join(tmpDir, 'output.csv') }]
      : [{ format: 'json' as const, path: outputPath }];

    let originalEnv: string | undefined;
    try {
      if (useEnvVar) {
        originalEnv = process.env.EXPORT_PASSWORD;
        process.env.EXPORT_PASSWORD = exportPassword;
      }

      const config: ConfigInterface = {
        inputPath,
        hashesOfLeaksPath,
        useHibpApi: false,
        singleFileReadMode: 'auto',
        buildIndex: false,
        includeSecrets: true,
        outputs,
        exportPassword,
      };

      if (expectError) {
        await expect(
          checkPasswordsLeaks(config, console),
        ).rejects.toThrow(expectError);
      } else {
        await checkPasswordsLeaks(config);

        const jsonOutput = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
        expect(jsonOutput).toHaveLength(expectedCount);
        expectedPasswords.forEach((pw) => {
          type JsonEntry = { passwordObjects: Array<{ login: { password: string } }> };
          const found = jsonOutput.some(
            (entry: JsonEntry) => entry.passwordObjects.some(
              (po) => po.login.password === pw,
            ),
          );
          expect(found).toBe(true);
        });

        if (dualOutput) {
          const csvOutput = fs.readFileSync(path.join(tmpDir, 'output.csv'), 'utf-8');
          expectedPasswords.forEach((pw) => {
            expect(csvOutput).toContain(pw);
          });
        }
      }
    } finally {
      if (useEnvVar) {
        if (originalEnv !== undefined) {
          process.env.EXPORT_PASSWORD = originalEnv;
        } else {
          delete process.env.EXPORT_PASSWORD;
        }
      }
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('cleans up sensitive data after pipeline completion', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cleanup-'));
    const outputPath = path.join(tmpDir, 'output.json');

    try {
      await checkPasswordsLeaks(
        makeConfig({ outputs: [{ format: 'json', path: outputPath }] }),
        console,
      );

      const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      expect(output).toHaveLength(3);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('dry run with useHibpApi — shows HIBP API mode, no hashes file', async () => {
    const mockInputHandler = vi.fn().mockImplementation(
      async (_p: string, _pw: string, onComplete?: () => void) => {
        onComplete?.();
        return [{ login_password: 'testpass' }];
      },
    );

    vi.doMock('../src/handlers/index.js', () => ({
      inputHandlers: { csv: mockInputHandler, json: mockInputHandler },
      outputHandlers: { json: vi.fn(), csv: vi.fn() },
    }));

    vi.resetModules();
    const { checkPasswordsLeaks: reloadedCheck } = await import('../src/checkPasswordsLeaks.js');

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      await reloadedCheck(
        {
          inputPath: path.join(fixturesDir, 'sample.csv'),
          hashesOfLeaksPath: '',
          useHibpApi: true,
          singleFileReadMode: 'auto',
          buildIndex: false,
          includeSecrets: true,
          outputs: [{ format: 'json', path: '/tmp/hibp-dryrun.json' }],
        },
        { dryRun: true },
      );

      const output = writeSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('Mode:             HIBP API (k-anonymity)');
      expect(output).not.toContain('Hashes file:');
    } finally {
      writeSpy.mockRestore();
    }
  });

  it.each([{ label: 'JSON', input: 'sample.json', outputFormat: 'json' as const }, { label: 'CSV', input: 'sample.csv', outputFormat: 'csv' as const }])('dry run with $label input — no output written', async ({ input, outputFormat }) => {
    const outDir = makeTmpDir();
    const outputPath = path.join(outDir, `should-not-exist.${outputFormat}`);
    const cfg: ConfigInterface = {
      inputPath: path.join(fixturesDir, input),
      hashesOfLeaksPath: path.join(fixturesDir, 'sample-hashes.txt'),
      useHibpApi: false,
      singleFileReadMode: 'auto',
      buildIndex: false,
      includeSecrets: true,
      outputs: [{ format: outputFormat, path: outputPath }],
    };

    await checkPasswordsLeaks(cfg, { dryRun: true });
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it('build index then scan — full pipeline', { timeout: 30000 }, async () => {
    const outDir = makeTmpDir();
    const hashFile = path.join(outDir, 'hashes.txt');
    const lines: string[] = [];
    for (let i = 0; i < 200; i += 1) {
      lines.push(`${i.toString(16).toUpperCase().padStart(40, '0')}:${100 + i}`);
    }
    fs.writeFileSync(hashFile, `${lines.join('\n')}\n`, 'ascii');

    const csvPath = path.join(outDir, 'input.csv');
    const csvLines = ['login_uri,login_username,login_password,name', 'https://example.com,user1,password1,Test1'];
    fs.writeFileSync(csvPath, csvLines.join('\n'), 'ascii');

    const outputPath = path.join(outDir, 'indexed.json');
    const cfg: ConfigInterface = {
      inputPath: csvPath,
      hashesOfLeaksPath: hashFile,
      useHibpApi: false,
      singleFileReadMode: 'sequential',
      buildIndex: true,
      includeSecrets: true,
      outputs: [{ format: 'json', path: outputPath }],
    };

    await checkPasswordsLeaks(cfg);

    const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    expect(Array.isArray(output)).toBe(true);

    const idxPath = `${hashFile}.idx`;
    expect(fs.existsSync(idxPath)).toBe(true);
    const idxStat = fs.statSync(idxPath);
    const hashStat = fs.statSync(hashFile);
    expect(idxStat.mtimeMs).toBeGreaterThan(hashStat.mtimeMs);
  });

  it('forced binary read mode — full pipeline', async () => {
    const outDir = makeTmpDir();
    const outputPath = path.join(outDir, 'binary.json');
    const cfg: ConfigInterface = {
      inputPath: path.join(fixturesDir, 'sample.csv'),
      hashesOfLeaksPath: path.join(fixturesDir, 'sample-hashes.txt'),
      useHibpApi: false,
      singleFileReadMode: 'binary',
      buildIndex: false,
      includeSecrets: true,
      outputs: [{ format: 'json', path: outputPath }],
    };

    await checkPasswordsLeaks(cfg);

    const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    expect(output.length).toBeGreaterThan(0);
    expect(output[0].passwordObjects[0].login_password).toBe('password123');
  });

  it('split directory with missing file — throws', async () => {
    const outDir = makeTmpDir();
    const splitDir = path.join(outDir, 'split');
    fs.mkdirSync(splitDir, { recursive: true });
    fs.writeFileSync(path.join(splitDir, 'AAAAA.txt'), 'A000000000000000000000000000000000000000:100\n', 'ascii');

    const outputPath = path.join(outDir, 'out.json');
    const cfg: ConfigInterface = {
      inputPath: path.join(fixturesDir, 'sample.csv'),
      hashesOfLeaksPath: splitDir,
      useHibpApi: false,
      singleFileReadMode: 'auto',
      buildIndex: false,
      includeSecrets: true,
      outputs: [{ format: 'json', path: outputPath }],
    };

    await expect(checkPasswordsLeaks(cfg)).resolves.not.toThrow();
    const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    expect(Array.isArray(output)).toBe(true);
  });

  it('split directory with extra .txt files — non-prefix files ignored', async () => {
    const outDir = makeTmpDir();
    const splitDir = path.join(outDir, 'split');
    fs.mkdirSync(splitDir, { recursive: true });
    fs.writeFileSync(
      path.join(splitDir, 'AAAAA.txt'),
      'A000000000000000000000000000000000000000:100\n',
      'ascii',
    );
    fs.writeFileSync(
      path.join(splitDir, 'readme.txt'),
      'this is not a hash file\n',
      'ascii',
    );
    fs.writeFileSync(
      path.join(splitDir, '.DS_Store'),
      'binary junk',
      'ascii',
    );

    const csvPath = path.join(outDir, 'input.csv');
    fs.writeFileSync(csvPath, ['login_uri,login_username,login_password,name', 'https://example.com,user1,password1,Test1'].join('\n'), 'ascii');

    const outputPath = path.join(outDir, 'split-filtered.json');
    const cfg: ConfigInterface = {
      inputPath: csvPath,
      hashesOfLeaksPath: splitDir,
      useHibpApi: false,
      singleFileReadMode: 'auto',
      buildIndex: false,
      includeSecrets: true,
      outputs: [{ format: 'json', path: outputPath }],
    };

    await checkPasswordsLeaks(cfg);

    const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    expect(Array.isArray(output)).toBe(true);
  });

  it('single file hash path — readMode forced via env', async () => {
    const outDir = makeTmpDir();
    const outputPath = path.join(outDir, 'env-forced.json');
    const cfg: ConfigInterface = {
      inputPath: path.join(fixturesDir, 'sample.csv'),
      hashesOfLeaksPath: path.join(fixturesDir, 'sample-hashes.txt'),
      useHibpApi: false,
      singleFileReadMode: 'auto',
      buildIndex: false,
      includeSecrets: true,
      outputs: [{ format: 'json', path: outputPath }],
    };

    const savedEnv = process.env.READ_MODE_FORCED;
    process.env.READ_MODE_FORCED = 'sequential-noindex';
    try {
      await checkPasswordsLeaks(cfg);

      const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      expect(output.length).toBeGreaterThan(0);
    } finally {
      if (savedEnv === undefined) delete process.env.READ_MODE_FORCED;
      else process.env.READ_MODE_FORCED = savedEnv;
    }
  });

  it('split directory with 15 prefix files — concurrent promisePool path exercised', { timeout: 30000 }, async () => {
    const outDir = makeTmpDir();
    const splitDir = path.join(outDir, 'split');
    fs.mkdirSync(splitDir, { recursive: true });

    const prefixCount = 15;

    for (let i = 0; i < prefixCount; i += 1) {
      const prefix = i.toString(16).toUpperCase().padStart(5, '0');
      const hash = `${prefix}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
      fs.writeFileSync(
        path.join(splitDir, `${prefix}.txt`),
        `${hash}:${50 + i}\n`,
        'ascii',
      );
    }

    const cfg: ConfigInterface = {
      inputPath: path.join(fixturesDir, 'sample.csv'),
      hashesOfLeaksPath: splitDir,
      useHibpApi: false,
      singleFileReadMode: 'auto',
      buildIndex: false,
      includeSecrets: true,
      outputs: [{ format: 'json', path: path.join(outDir, 'split-15.json') }],
    };

    await checkPasswordsLeaks(cfg);

    const outputPath = path.join(outDir, 'split-15.json');
    const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    expect(Array.isArray(output)).toBe(true);
  });
});
