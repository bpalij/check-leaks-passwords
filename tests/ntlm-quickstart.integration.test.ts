import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';

import { vi } from 'vitest';

import { checkPasswordsLeaks } from '../src/checkPasswordsLeaks.js';
import { processSingleFile } from '../src/io/processSingleFile.js';
import { processSplitDirectory } from '../src/io/processSplitDirectory.js';
import { processHibpApi } from '../src/io/processHibpApi.js';
import { convertArrayToMap } from '../src/hashing/convertArrayToMap.js';
import type { ConfigInterface, PasswordObject, PasswordObjectWithHash } from '../src/types.js';
import { NTLM_HEX_LENGTH } from '../src/constants.js';
import { FIXTURES_DIR } from './helpers/fixturesDir.js';
import { ntlm } from './helpers/ntlm.js';

const fixturesDir = FIXTURES_DIR;
const outDir = path.join(import.meta.dirname, '__output__');

/** NTLM reference vectors (quickstart.md). */
const NTLM_CORPUS = new Map<string, number>([
  ['32ED87BDB5FDC5E9CBA88547376818D4', 37281043],
  ['8846F7EAEE8FB117AD06BDD830B7586C', 99999],
  ['9BDC61DB5A3FCED6D82D49279F1F0430', 250],
  ['A9FDFA038C4B75EBC76DC855DD74F0DA', 1000],
  ['BECEDB42EC3C5C7F965255338BE4453C', 250000],
]);

/**
 * Hashes present in both the NTLM corpus and the vault fixture. The corpus also
 * carries one extra hash (`00000000`) whose password is not in the vault.
 */
const EXPECTED_MATCHES = new Map<string, number>(
  [...NTLM_CORPUS].filter(([hash]) => hash !== '9BDC61DB5A3FCED6D82D49279F1F0430'),
);

function makeConfig(overrides: Partial<ConfigInterface> = {}): ConfigInterface {
  return {
    inputPath: path.join(fixturesDir, 'ntlm-vault.json'),
    hashesOfLeaksPath: path.join(fixturesDir, 'ntlm-hashes.txt'),
    useHibpApi: false,
    singleFileReadMode: 'auto',
    buildIndex: false,
    includeSecrets: true,
    outputs: [{ format: 'json', path: path.join(outDir, `quickstart-${Date.now()}.json`) }],
    ...overrides,
  };
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ntlm-quickstart-'));
}

function createNtlmApiServer(hashToCount: Map<string, number>) {
  const requestedPrefixes: string[] = [];
  const server = http.createServer((req, res) => {
    const prefix = (req.url ?? '').replace('/', '');
    requestedPrefixes.push(prefix);
    const lines: string[] = [];
    hashToCount.forEach((count, fullHash) => {
      if (fullHash.startsWith(prefix)) lines.push(`${fullHash.slice(5)}:${count}`);
    });
    res.writeHead(200, { 'cf-cache-status': 'MISS' });
    res.end(lines.join('\n'));
  });
  return new Promise<{ url: string; prefixes: string[]; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('Server has no address');
      resolve({
        url: `http://127.0.0.1:${addr.port}/`,
        prefixes: requestedPrefixes,
        close: () => new Promise<void>((res, rej) => {
          server.close((err) => (err ? rej(err) : res()));
        }),
      });
    });
  });
}

describe('NTLM quickstart harness — scenarios 1-7', () => {
  it('scenario 1: explicit NTLM with a single-file corpus', async () => {
    const outputPath = path.join(outDir, `qs1-${Date.now()}.json`);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await checkPasswordsLeaks(makeConfig({
        hashType: 'ntlm',
        outputs: [{ format: 'json', path: outputPath }],
      }));
      const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      const byHash = new Map(output.map((e: { hash: string; leaks: number }) => [e.hash, e.leaks]));
      EXPECTED_MATCHES.forEach((count, hash) => {
        expect(byHash.get(hash)).toBe(count);
      });
      expect(output).toHaveLength(EXPECTED_MATCHES.size);
      expect(output[0].passwordObjects[0].login_password_hash_type).toBe('ntlm');
      expect(stdoutSpy.mock.calls.map((c) => String(c[0])).join('')).toContain('Hash type: ntlm (explicit)');
    } finally {
      stdoutSpy.mockRestore();
      try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
    }
  });

  it('scenario 2: auto-detection with an NTLM corpus resolves to ntlm', async () => {
    const outputPath = path.join(outDir, `qs2-${Date.now()}.json`);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await checkPasswordsLeaks(makeConfig({
        hashType: 'auto',
        outputs: [{ format: 'json', path: outputPath }],
      }));
      const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      expect(output).toHaveLength(EXPECTED_MATCHES.size);
      expect(output[0].passwordObjects[0].login_password_hash_type).toBe('ntlm');
      expect(stdoutSpy.mock.calls.map((c) => String(c[0])).join('')).toContain('Hash type: ntlm (detected)');
    } finally {
      stdoutSpy.mockRestore();
      try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
    }
  });

  it('scenario 3: default run with a SHA-1 corpus is backward compatible', async () => {
    const outputPath = path.join(outDir, `qs3-${Date.now()}.json`);
    try {
      await checkPasswordsLeaks(makeConfig({
        inputPath: path.join(fixturesDir, 'sample.csv'),
        hashesOfLeaksPath: path.join(fixturesDir, 'sample-hashes.txt'),
        // no hashType -> auto -> sha1
        outputs: [{ format: 'json', path: outputPath }],
      }));
      const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      expect(output).toHaveLength(3);
      expect(output[0].leaks).toBe(1000);
      expect(output[0].passwordObjects[0].login_password_hash_type).toBe('sha1');
    } finally {
      try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
    }
  });

  it('scenario 4: mismatch in error mode aborts naming requested and detected types', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await expect(checkPasswordsLeaks(makeConfig({
        inputPath: path.join(fixturesDir, 'sample.csv'),
        hashesOfLeaksPath: path.join(fixturesDir, 'sample-hashes.txt'),
        hashType: 'ntlm',
        hashTypeMismatch: 'error',
      }))).rejects.toThrow(/HASH_TYPE=ntlm was requested, but the corpus contains sha1 hashes/);
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  it('scenario 5: mismatch in warn mode self-corrects to the detected type', async () => {
    const outputPath = path.join(outDir, `qs5-${Date.now()}.json`);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await checkPasswordsLeaks(makeConfig({
        inputPath: path.join(fixturesDir, 'sample.csv'),
        hashesOfLeaksPath: path.join(fixturesDir, 'sample-hashes.txt'),
        hashType: 'ntlm',
        hashTypeMismatch: 'warn',
        outputs: [{ format: 'json', path: outputPath }],
      }));
      const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      expect(output[0].passwordObjects[0].login_password_hash_type).toBe('sha1');
      expect(stdoutSpy.mock.calls.map((c) => String(c[0])).join('')).toContain('Hash type: sha1 (corrected from ntlm)');
      expect(stderrSpy.mock.calls.map((c) => String(c[0])).join('')).toContain('sha1');
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
      try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
    }
  });

  it('scenario 6: NTLM API mode transmits only the 5-char prefix and matches loc', async () => {
    const server = await createNtlmApiServer(NTLM_CORPUS);
    try {
      // validateConfig requires HTTPS for the API URL, and the loopback stub is
      // plain HTTP, so exercise the API path directly (as other API tests do).
      const passwords = [
        'password',
        '123456',
        'letmein',
        'password123',
        'notleaked-unique-password',
      ];
      const input: Array<PasswordObjectWithHash> = passwords.map((pw) => ({
        hash: ntlm(pw),
        passwordObject: { login_password: pw },
      }));
      const results = await processHibpApi(
        convertArrayToMap(input),
        server.url,
        undefined,
        undefined,
        undefined,
        NTLM_HEX_LENGTH,
      );
      const byHash = new Map(results.map((r) => [r.hash, r.leaks]));
      EXPECTED_MATCHES.forEach((count, hash) => {
        expect(byHash.get(hash)).toBe(count);
      });
      expect(results).toHaveLength(EXPECTED_MATCHES.size);
      // Only 5-character prefixes were requested.
      expect(server.prefixes.length).toBeGreaterThan(0);
      server.prefixes.forEach((p) => {
        expect(p).toMatch(/^[0-9a-fA-F]{5}$/);
      });
    } finally {
      await server.close();
    }
  });

  it('scenario 7: auto-detection with an NTLM split-prefix directory', async () => {
    const outputPath = path.join(outDir, `qs7-${Date.now()}.json`);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await checkPasswordsLeaks(makeConfig({
        hashesOfLeaksPath: path.join(fixturesDir, 'ntlm-split'),
        hashType: 'auto',
        outputs: [{ format: 'json', path: outputPath }],
      }));
      const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      expect(output).toHaveLength(EXPECTED_MATCHES.size);
      expect(stdoutSpy.mock.calls.map((c) => String(c[0])).join('')).toContain('Hash type: ntlm (detected)');
    } finally {
      stdoutSpy.mockRestore();
      try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
    }
  });
});

describe('NTLM cross-cutting: empty-password filtering and bounded memory', () => {
  it('filters empty passwords before hashing regardless of hash type', async () => {
    const dir = tmpDir();
    const vaultPath = path.join(dir, 'vault.json');
    fs.writeFileSync(vaultPath, JSON.stringify({
      items: [
        { type: 1, name: 'Empty', login: { password: '', username: 'a' } },
        { type: 1, name: 'Whitespace', login: { password: '   ', username: 'b' } },
        { type: 1, name: 'Valid', login: { password: 'password', username: 'c' } },
      ],
    }), 'utf-8');

    const outputPath = path.join(dir, 'out.json');
    try {
      await checkPasswordsLeaks(makeConfig({
        inputPath: vaultPath,
        hashType: 'ntlm',
        outputs: [{ format: 'json', path: outputPath }],
      }));
      const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      type Record_ = { passwordObjects: Array<{ login: { password?: string } }> };
      const passwords = (output as Record_[]).flatMap(
        (e) => e.passwordObjects.map((p) => p.login.password),
      );
      expect(passwords).toEqual(['password']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('NTLM single-file scan keeps memory bounded (no full-corpus load)', { timeout: 120000 }, async () => {
    const dir = tmpDir();
    const corpusPath = path.join(dir, 'ntlm-large.txt');
    const lineCount = 1_200_000;
    const writeStream = fs.createWriteStream(corpusPath);
    for (let i = 0; i < lineCount; i += 1) {
      const hash = i.toString(16).toUpperCase().padStart(32, '0').slice(-32);
      if (!writeStream.write(`${hash}:${i % 1000}\n`)) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
          writeStream.once('drain', resolve);
        });
      }
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end((err?: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
    const corpusBytes = fs.statSync(corpusPath).size;

    const map = new Map<string, PasswordObject[]>();
    map.set('8846F7EAEE8FB117AD06BDD830B7586C', [{ login_password: 'password' }]);

    const prevHwm = process.env.HIGH_WATER_MARK;
    process.env.HIGH_WATER_MARK = '1';
    const before = process.memoryUsage().heapUsed;
    try {
      await processSingleFile(
        map,
        corpusPath,
        'ascii',
        undefined,
        undefined,
        undefined,
        'sequential',
        false,
        NTLM_HEX_LENGTH,
      );
      const after = process.memoryUsage().heapUsed;
      const growth = after - before;
      expect(growth).toBeLessThan(corpusBytes / 2);
    } finally {
      if (prevHwm === undefined) delete process.env.HIGH_WATER_MARK;
      else process.env.HIGH_WATER_MARK = prevHwm;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('NTLM split-directory scan keeps memory bounded', { timeout: 120000 }, async () => {
    const dir = tmpDir();
    const fileCount = 400;
    const linesPerFile = 4000;
    for (let f = 0; f < fileCount; f += 1) {
      const prefix = f.toString(16).toUpperCase().padStart(5, '0').slice(-5);
      const lines: string[] = [];
      for (let i = 0; i < linesPerFile; i += 1) {
        lines.push(`${(i + f).toString(16).toUpperCase().padStart(27, '0').slice(-27)}:${i % 500}`);
      }
      fs.writeFileSync(path.join(dir, `${prefix}.txt`), `${lines.join('\n')}\n`, 'ascii');
    }
    const totalBytes = fs.readdirSync(dir).reduce(
      (sum, name) => sum + fs.statSync(path.join(dir, name)).size,
      0,
    );

    const map = new Map<string, PasswordObject[]>();
    map.set('8846F7EAEE8FB117AD06BDD830B7586C', [{ login_password: 'password' }]);

    const before = process.memoryUsage().heapUsed;
    try {
      await processSplitDirectory(map, dir, 'ascii', undefined, undefined, NTLM_HEX_LENGTH);
      const after = process.memoryUsage().heapUsed;
      expect(after - before).toBeLessThan(totalBytes / 2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
