import path from 'path';
import fs from 'fs';
import { Readable } from 'stream';

import { vi } from 'vitest';

import { checkPasswordsLeaks } from '../src/checkPasswordsLeaks.js';
import * as determineOptimalChunkCountModule from '../src/memory/determineOptimalChunkCount.js';
import { generateEncryptedExport } from '../src/crypto/generateEncryptedExport.js';
import type { ConfigInterface } from '../src/types.js';
import { FIXTURES_DIR } from './helpers/fixturesDir.js';
import { sha1 } from './helpers/sha1.js';
import { ntlm } from './helpers/ntlm.js';
import { writeLargeSha1Corpus } from './helpers/largeCorpus.js';
import { makeTestDir, makeTestFilePath } from './helpers/testTmp.js';

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
  outputs: [{ format: 'json', path: makeTestFilePath(`test_${Date.now()}.json`) }],
  ...overrides,
});

/**
 * Directories created by {@link makeTmpDir}, cleaned up once after the file
 * finishes so that large synthetic corpora never leak on disk (a timed-out
 * test would otherwise skip its own `finally` cleanup).
 */
const createdTmpDirs: string[] = [];

// A corpus above the (overridden) sortedness threshold is required to build an
// `.idx`; 96 KiB clears the 80 KiB non-overlap floor.
const SMALL_CORPUS_BYTES = 96 * 1024;
const SMALL_FILE_THRESHOLD_ENV = '65536';

/**
 * Create a unique temporary directory for a test.
 *
 * @returns Absolute path to the newly created directory.
 */
function makeTmpDir(): string {
  const dir = makeTestDir('wf-int-');
  createdTmpDirs.push(dir);
  return dir;
}

afterAll(() => {
  createdTmpDirs.forEach((dir) => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
  createdTmpDirs.length = 0;
});

describe('checkPasswordsLeaks integration', () => {
  it('runs the full pipeline with CSV input and multiple outputs', async () => {
    const jsonPath = makeTestFilePath(`csv-pipeline-${Date.now()}.json`);
    const csvPath = makeTestFilePath(`csv-pipeline-${Date.now()}.csv`);
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
    const jsonPath = makeTestFilePath(`json-pipeline-${Date.now()}.json`);
    const csvPath = makeTestFilePath(`json-pipeline-${Date.now()}.csv`);
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
    const tmpDir = makeTestDir('e2e-accrestricted-');
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
    const tmpDir = makeTestDir('e2e-nopw-');
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
    const outputPath = makeTestFilePath(`no-matches-${Date.now()}.json`);
    const cfg = makeConfig({
      hashesOfLeaksPath: path.join(fixturesDir, 'empty-hashes.txt'),
      outputs: [{ format: 'json', path: outputPath }],
    });

    await expect(checkPasswordsLeaks(cfg)).rejects.toThrow(/hash type/i);
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
    const outputPath = makeTestFilePath(`sort-ascending-${Date.now()}.json`);
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
    const outputPath = makeTestFilePath(`sort-same-leaks-${Date.now()}.json`);
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
    const jsonPath = makeTestFilePath(`split-csv-${Date.now()}.json`);
    const csvPath = makeTestFilePath(`split-csv-${Date.now()}.csv`);
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
    const jsonPath = makeTestFilePath(`split-json-${Date.now()}.json`);
    const csvPath = makeTestFilePath(`split-json-${Date.now()}.csv`);
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

    const outputPath = makeTestFilePath(`multi-chunk-${Date.now()}.json`);
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
    const jsonPath = makeTestFilePath(`hibp-${Date.now()}.json`);
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
    const tmpDir = makeTestDir('e2e-dynamic-');
    const outputPath = makeTestFilePath(`e2e-dynamic-${Date.now()}.json`);
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
    const tmpDir = makeTestDir('e2e-malformed-');
    const outputPath = makeTestFilePath(`e2e-malformed-${Date.now()}.json`);
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
    const tmpDir = makeTestDir('e2e-dup-');
    const outputPath = makeTestFilePath(`e2e-dup-${Date.now()}.json`);
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
    const tmpDir = makeTestDir('e2e-empty-');
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
    const tmpDir = makeTestDir('e2e-encrypted-');
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
    const tmpDir = makeTestDir('e2e-cleanup-');
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

  it('NTLM run reports hash type in summary and per-record outputs', async () => {
    const outputPath = makeTestFilePath(`ntlm-${Date.now()}.json`);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await checkPasswordsLeaks(makeConfig({
        inputPath: path.join(fixturesDir, 'ntlm-vault.json'),
        hashesOfLeaksPath: path.join(fixturesDir, 'ntlm-hashes.txt'),
        hashType: 'ntlm',
        outputs: [{ format: 'json', path: outputPath }],
      }));

      const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      expect(output.length).toBeGreaterThan(0);
      expect(output[0].passwordObjects[0].login_password_hash_type).toBe('ntlm');
      const printed = writeSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(printed).toContain('Hash type: ntlm (explicit)');
    } finally {
      writeSpy.mockRestore();
      try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
    }
  });

  it('auto-detects NTLM and matches a BOM-prefixed single-file corpus end to end', async () => {
    const tmpDir = makeTestDir('e2e-bom-ntlm-');
    const outputPath = makeTestFilePath(`e2e-bom-ntlm-${Date.now()}.json`);
    const csvPath = path.join(tmpDir, 'input.csv');
    const hashPath = path.join(tmpDir, 'hashes.txt');

    const matchHash = ntlm('password123');
    const bom = Buffer.from([
      0xef,
      0xbb,
      0xbf,
    ]);
    fs.writeFileSync(
      hashPath,
      Buffer.concat([
        bom,
        Buffer.from(`${matchHash}:12345\n`, 'ascii'),
        Buffer.from(`${'0'.repeat(32)}:0\n`, 'ascii'),
      ]),
    );

    fs.writeFileSync(
      csvPath,
      'login_password,login_username,name,folder\n'
      + 'password123,u1,Site A,Work\n'
      + 'nope-not-leaked,u2,Site B,Personal\n',
      'utf-8',
    );

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await checkPasswordsLeaks(makeConfig({
        inputPath: csvPath,
        hashesOfLeaksPath: hashPath,
        hashType: 'auto',
        outputs: [{ format: 'json', path: outputPath }],
      }));

      const printed = writeSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(printed).toContain('Hash type: ntlm (detected)');

      const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      expect(output).toHaveLength(1);
      expect(output[0].hash).toBe(matchHash);
      expect(output[0].leaks).toBe(12345);
      expect(output[0].passwordObjects[0].login_password).toBe('password123');
      expect(output[0].passwordObjects[0].login_password_hash_type).toBe('ntlm');
    } finally {
      writeSpy.mockRestore();
      try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
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

    const dryRunOutDir = makeTmpDir();
    try {
      await reloadedCheck(
        {
          inputPath: path.join(fixturesDir, 'sample.csv'),
          hashesOfLeaksPath: '',
          useHibpApi: true,
          singleFileReadMode: 'auto',
          buildIndex: false,
          includeSecrets: true,
          outputs: [{ format: 'json', path: path.join(dryRunOutDir, 'hibp-dryrun.json') }],
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

  it('build index then scan — full pipeline', { timeout: 180000 }, async () => {
    const outDir = makeTmpDir();
    const hashFile = path.join(outDir, 'hashes.txt');
    // A `.idx` is only built for verified-sorted input, so the corpus is kept
    // above the overridden threshold to run the live sortedness check.
    writeLargeSha1Corpus(hashFile, SMALL_CORPUS_BYTES, [256]);

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

    const savedThreshold = process.env.SMALL_FILE_BYTES_THRESHOLD;
    process.env.SMALL_FILE_BYTES_THRESHOLD = SMALL_FILE_THRESHOLD_ENV;
    try {
      await checkPasswordsLeaks(cfg);
    } finally {
      if (savedThreshold === undefined) delete process.env.SMALL_FILE_BYTES_THRESHOLD;
      else process.env.SMALL_FILE_BYTES_THRESHOLD = savedThreshold;
    }

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
    fs.writeFileSync(path.join(splitDir, 'AAAAA.txt'), `${'A'.repeat(35)}:100\n`, 'ascii');

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
      `${'A'.repeat(35)}:100\n`,
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
      fs.writeFileSync(
        path.join(splitDir, `${prefix}.txt`),
        `${'A'.repeat(35)}:${50 + i}\n`,
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

describe('checkPasswordsLeaks — hash-type governance and API notice (US2/US3)', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function sha1Counts(): Map<string, number> {
    const lines = fs.readFileSync(path.join(fixturesDir, 'sample-hashes.txt'), 'utf-8').trim().split('\n');
    const counts = new Map<string, number>();
    lines.forEach((line) => {
      const [fullHash, count] = line.split(':');
      counts.set(fullHash, Number(count));
    });
    return counts;
  }

  function stubSha1Api(): void {
    const counts = sha1Counts();
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      const prefix = url.split('/').pop() ?? '';
      const lines: string[] = [];
      counts.forEach((count, fullHash) => {
        if (fullHash.startsWith(prefix)) lines.push(`${fullHash.slice(5)}:${count}`);
      });
      return {
        ok: true,
        headers: { get: () => 'MISS' },
        arrayBuffer: () => Promise.resolve(Buffer.from(lines.join('\n'), 'ascii')),
      };
    }) as unknown as typeof global.fetch;
  }

  it('API + auto resolves to sha1 with a notice on stderr and in the summary (FR-006)', async () => {
    stubSha1Api();
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const outputPath = makeTestFilePath(`api-auto-${Date.now()}.json`);
    try {
      await checkPasswordsLeaks(makeConfig({
        hashesOfLeaksPath: '',
        useHibpApi: true,
        hashType: 'auto',
        outputs: [{ format: 'json', path: outputPath }],
      }));

      const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(err).toContain('auto');
      expect(err).toContain('sha1');
      expect(err).toContain('HASH_TYPE=ntlm');
      expect(out).toContain('Hash type: sha1 (auto not applicable in API mode)');
      expect(out).toContain('Notice:');
    } finally {
      try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
    }
  });

  it('warn mode self-corrects, surfaces the override, and matches an explicit sha1 run (FR-007/SC-007)', async () => {
    const correctedPath = makeTestFilePath(`mismatch-warn-${Date.now()}.json`);
    const explicitPath = makeTestFilePath(`mismatch-explicit-${Date.now()}.json`);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await checkPasswordsLeaks(makeConfig({
        hashesOfLeaksPath: path.join(fixturesDir, 'sample-hashes.txt'),
        hashType: 'ntlm',
        hashTypeMismatch: 'warn',
        outputs: [{ format: 'json', path: correctedPath }],
      }));
      await checkPasswordsLeaks(makeConfig({
        hashesOfLeaksPath: path.join(fixturesDir, 'sample-hashes.txt'),
        hashType: 'sha1',
        outputs: [{ format: 'json', path: explicitPath }],
      }));

      const corrected = JSON.parse(fs.readFileSync(correctedPath, 'utf-8'));
      const explicit = JSON.parse(fs.readFileSync(explicitPath, 'utf-8'));
      expect(corrected).toEqual(explicit);
      expect(corrected[0].passwordObjects[0].login_password_hash_type).toBe('sha1');

      const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(err).toContain('ntlm');
      expect(err).toContain('sha1');
      expect(out).toContain('Hash type: sha1 (corrected from ntlm)');
    } finally {
      try { fs.unlinkSync(correctedPath); } catch { /* ignore */ }
      try { fs.unlinkSync(explicitPath); } catch { /* ignore */ }
    }
  });

  it('error mode aborts on an explicit-vs-detected mismatch before scanning (FR-007/SC-004)', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await expect(checkPasswordsLeaks(makeConfig({
        hashesOfLeaksPath: path.join(fixturesDir, 'sample-hashes.txt'),
        hashType: 'ntlm',
        hashTypeMismatch: 'error',
      }))).rejects.toThrow('HASH_TYPE=ntlm was requested, but the corpus contains sha1 hashes');

      const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(out).not.toContain('Scanning file');
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  function stubNtlmApi(): { rawUrls: string[] } {
    const lines = fs.readFileSync(
      path.join(fixturesDir, 'ntlm-hashes.txt'),
      'utf-8',
    ).trim().split('\n');
    const counts = new Map<string, number>();
    lines.forEach((line) => {
      const [fullHash, count] = line.split(':');
      counts.set(fullHash, Number(count));
    });
    const rawUrls: string[] = [];
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      rawUrls.push(url);
      // Only the NTLM corpus carries the mode query; without it the endpoint
      // serves SHA-1 data, so this stub deliberately returns nothing then.
      const [prefix, query] = (url.split('/').pop() ?? '').split('?');
      const out: string[] = [];
      if (query === 'mode=ntlm') {
        counts.forEach((count, fullHash) => {
          if (fullHash.startsWith(prefix)) out.push(`${fullHash.slice(5)}:${count}`);
        });
      }
      return {
        ok: true,
        headers: { get: () => 'MISS' },
        arrayBuffer: () => Promise.resolve(Buffer.from(out.join('\n'), 'ascii')),
      };
    }) as unknown as typeof global.fetch;
    return { rawUrls };
  }

  it('end-to-end NTLM API run requests the NTLM corpus and matches its hashes (SC-003)', async () => {
    const api = stubNtlmApi();
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const outputPath = makeTestFilePath(`api-ntlm-${Date.now()}.json`);
    try {
      await checkPasswordsLeaks(makeConfig({
        inputPath: path.join(fixturesDir, 'ntlm-vault.json'),
        hashesOfLeaksPath: '',
        useHibpApi: true,
        hashType: 'ntlm',
        outputs: [{ format: 'json', path: outputPath }],
      }));

      const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      expect(output).toHaveLength(4);
      const byHash = new Map(
        output.map((r: { hash: string; leaks: number }) => [r.hash, r.leaks]),
      );
      expect(byHash.get(ntlm('password'))).toBe(99999);
      expect(byHash.get(ntlm('123456'))).toBe(37281043);
      expect(byHash.get(ntlm('letmein'))).toBe(250000);
      expect(byHash.get(ntlm('password123'))).toBe(1000);
      output.forEach((r: { passwordObjects: Array<{ login_password_hash_type: string }> }) => {
        expect(r.passwordObjects[0].login_password_hash_type).toBe('ntlm');
      });

      // Without `?mode=ntlm` the buggy code would hit the SHA-1 corpus and
      // silently report zero leaks; this guards that regression end to end.
      expect(api.rawUrls.length).toBeGreaterThan(0);
      api.rawUrls.forEach((u) => expect(u).toContain('mode=ntlm'));
    } finally {
      try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  it('rejects an invalid hash type before any reading or scanning begins (FR-009/SC-004)', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await expect(checkPasswordsLeaks(makeConfig({
        hashType: 'md5' as 'auto',
      }))).rejects.toThrow('hashType must be one of: auto, sha1, ntlm');

      const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(out).not.toContain('Input format');
    } finally {
      stdoutSpy.mockRestore();
    }
  });
});
