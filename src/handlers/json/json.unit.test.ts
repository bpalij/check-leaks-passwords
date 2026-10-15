import path from 'path';
import fs from 'fs';
import os from 'os';
import { EventEmitter } from 'events';

import {
  describe, it, expect, vi,
} from 'vitest';

import { readJsonInputFile } from './read.js';
import { writeJsonOutputFile } from './write.js';
import { generateEncryptedExport } from '../../crypto/generateEncryptedExport.js';
import type {
  NestedPasswordObject, HashWithLeaksAndPasswordObjects, PasswordObject,
} from '../../types.js';
import { FIXTURES_DIR } from '../../../tests/helpers/fixturesDir.js';

const fixturesDir = FIXTURES_DIR;

function createFakeStdin(options?: { tty?: boolean }) {
  const isTTY = options?.tty !== false;
  const stdin = new EventEmitter() as EventEmitter & {
    setRawMode: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    setEncoding: ReturnType<typeof vi.fn>;
    isTTY: boolean;
  };
  if (isTTY) {
    stdin.setRawMode = vi.fn();
  }
  stdin.resume = vi.fn();
  stdin.pause = vi.fn();
  stdin.setEncoding = vi.fn();
  stdin.isTTY = isTTY;
  return stdin;
}

describe('JSON input handler', () => {
  it('reads a valid Bitwarden JSON file', async () => {
    const result = await readJsonInputFile(path.join(fixturesDir, 'sample.json')) as unknown as NestedPasswordObject[];
    expect(result).toHaveLength(2);
    expect(result[0].login.password).toBe('password123');
    expect(result[0].folderName).toBe('Social');
    expect(result[0].login.uris).toEqual([{ uri: 'https://example.com', match: null }]);
    expect(result[0].login.login_uris).toEqual(['https://example.com']);
    expect(result[0].typeLabel).toBe('Login');
    expect(result[0].repromptLabel).toBe('None');
    expect(result[0].hasTotp).toBe(false);
    expect(result[0].hasPasskey).toBe(false);
    expect(result[0].uriCount).toBe(1);
    expect(result[0].hasCustomFields).toBe(false);
    expect(result[1].login.password).toBe('letmein');
    expect(result[1].folderName).toBe('Work');
    expect(result[1].typeLabel).toBe('Login');
    expect(result[1].repromptLabel).toBe('Require master password');
  });

  it('throws when there are no items with passwords', async () => {
    await expect(
      readJsonInputFile(path.join(fixturesDir, 'empty-items.json')),
    ).rejects.toThrow('No non-empty passwords found');
  });

  it('throws for missing items field', async () => {
    await expect(
      readJsonInputFile(path.join(fixturesDir, 'empty-items.json')),
    ).rejects.toThrow('No non-empty passwords found');
  });

  it('throws when items is null', async () => {
    await expect(
      readJsonInputFile(path.join(fixturesDir, 'no-items.json')),
    ).rejects.toThrow('No items found');
  });

  it('reads items without folders or uris', async () => {
    const result = await readJsonInputFile(path.join(fixturesDir, 'minimal-items.json')) as unknown as NestedPasswordObject[];
    expect(result).toHaveLength(1);
    expect(result[0].login.password).toBe('minimalpass');
    expect(result[0].folderName).toBeUndefined();
    expect(result[0].login.uris).toBeNull();
  });

  it('rejects on non-existent file', async () => {
    await expect(
      readJsonInputFile('/nonexistent/file.json'),
    ).rejects.toThrow();
  });

  it('defaults typeLabel and repromptLabel when type/reprompt are missing', async () => {
    const result = await readJsonInputFile(path.join(fixturesDir, 'json-missing-type-reprompt.json'));
    expect(result).toHaveLength(2);
    expect(result[0].typeLabel).toBe('Login');
    expect(result[0].repromptLabel).toBe('None');
    expect(result[1].typeLabel).toBe('Secure Note');
    expect(result[1].repromptLabel).toBe('None');
  });

  it('computes passwordAgeDays from revisionDate', async () => {
    const result = await readJsonInputFile(path.join(fixturesDir, 'json-with-revision.json')) as unknown as NestedPasswordObject[];
    expect(result).toHaveLength(1);
    expect(result[0].login.password).toBe('pass123');
    expect(result[0].folderName).toBe('Social');
    expect(result[0].passwordAgeDays).toBeGreaterThan(0);
  });

  it('handles folders without id or name', async () => {
    const result = await readJsonInputFile(path.join(fixturesDir, 'folders-without-id.json')) as unknown as NestedPasswordObject[];
    expect(result).toHaveLength(1);
    expect(result[0].login.password).toBe('socialpass');
    expect(result[0].folderName).toBe('Social');
  });

  it('sets hasPasskey and hasCustomFields to true when present', async () => {
    const result = await readJsonInputFile(path.join(fixturesDir, 'json-with-passkey-fields.json')) as unknown as NestedPasswordObject[];
    expect(result).toHaveLength(1);
    expect(result[0].login.password).toBe('passkeypass');
    expect(result[0].hasPasskey).toBe(true);
    expect(result[0].hasCustomFields).toBe(true);
    expect(result[0].hasTotp).toBe(true);
    expect(result[0].uriCount).toBe(1);
  });

  it('decrypts encrypted export with correct password', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-input-enc-'));
    const inputPath = path.join(tmpDir, 'encrypted.json');

    const vault = {
      folders: [{ id: '1', name: 'Social' }],
      items: [
        {
          folderId: '1',
          type: 1,
          name: 'Test Site',
          login: {
            password: 'encpass123',
            username: 'user@test.com',
            uris: [{ uri: 'https://test.com', match: null }],
          },
        },
      ],
    };

    const encrypted = generateEncryptedExport(
      JSON.stringify(vault),
      'my-export-password',
      { kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0) },
    );
    fs.writeFileSync(inputPath, encrypted, 'utf-8');

    try {
      const result = await readJsonInputFile(inputPath, 'my-export-password') as unknown as NestedPasswordObject[];
      expect(result).toHaveLength(1);
      expect(result[0].login.password).toBe('encpass123');
      expect(result[0].folderName).toBe('Social');
      expect(result[0].login.uris).toEqual([{ uri: 'https://test.com', match: null }]);
      expect(result[0].login.login_uris).toEqual(['https://test.com']);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('shows "CLI/env var" spinner when password is provided directly', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-input-spinner-cli-'));
    const inputPath = path.join(tmpDir, 'encrypted.json');

    const vault = {
      items: [
        {
          type: 1,
          name: 'Test',
          login: { password: 'encpass', username: 'user@test.com' },
        },
      ],
    };

    const encrypted = generateEncryptedExport(
      JSON.stringify(vault),
      'my-password',
      { kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0) },
    );
    fs.writeFileSync(inputPath, encrypted, 'utf-8');

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const result = await readJsonInputFile(inputPath, 'my-password') as unknown as NestedPasswordObject[];
      expect(result).toHaveLength(1);
      const output = writeSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('Using password from CLI/env var');
    } finally {
      writeSpy.mockRestore();
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('shows "CLI/env var" spinner when password is passed via parameter', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-input-spinner-env-'));
    const inputPath = path.join(tmpDir, 'encrypted.json');

    const vault = {
      items: [
        {
          type: 1,
          name: 'Test',
          login: { password: 'envpass', username: 'user@test.com' },
        },
      ],
    };

    const encrypted = generateEncryptedExport(
      JSON.stringify(vault),
      'env-password',
      { kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0) },
    );
    fs.writeFileSync(inputPath, encrypted, 'utf-8');

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const result = await readJsonInputFile(inputPath, 'env-password') as unknown as NestedPasswordObject[];
      expect(result).toHaveLength(1);
      const output = writeSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('Using password from CLI/env var');
    } finally {
      writeSpy.mockRestore();
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('throws for encrypted export with wrong password', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-input-wrongpw-'));
    const inputPath = path.join(tmpDir, 'encrypted.json');

    const vault = {
      items: [
        {
          type: 1,
          name: 'Test',
          login: { password: 'pass123', username: 'user@test.com' },
        },
      ],
    };

    const encrypted = generateEncryptedExport(
      JSON.stringify(vault),
      'correct-password',
      { kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0) },
    );
    fs.writeFileSync(inputPath, encrypted, 'utf-8');

    try {
      await expect(
        readJsonInputFile(inputPath, 'wrong-password'),
      ).rejects.toThrow('Incorrect password');
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('throws for account-restricted encrypted export', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-input-accrestrict-'));
    const inputPath = path.join(tmpDir, 'encrypted.json');

    const encrypted = generateEncryptedExport(
      JSON.stringify({ items: [] }),
      'test-password',
      { kdfType: 0, iterations: 1000, salt: Buffer.alloc(16, 0) },
    );
    const modified = encrypted.replace('"passwordProtected":true', '"passwordProtected":false');
    fs.writeFileSync(inputPath, modified, 'utf-8');

    try {
      await expect(
        readJsonInputFile(inputPath, 'test-password'),
      ).rejects.toThrow('account-restricted');
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('throws for decrypted export without items array', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-input-noitems-'));
    const inputPath = path.join(tmpDir, 'encrypted.json');

    const encrypted = generateEncryptedExport(
      JSON.stringify({ folders: [] }),
      'test-password',
      { kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0) },
    );
    fs.writeFileSync(inputPath, encrypted, 'utf-8');

    try {
      await expect(
        readJsonInputFile(inputPath, 'test-password'),
      ).rejects.toThrow('No items found in the decrypted JSON file');
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('decrypts via interactive prompt with raw mode asterisks', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-input-interactive-'));
    const inputPath = path.join(tmpDir, 'encrypted.json');

    const vault = {
      items: [
        {
          type: 1,
          name: 'Interactive',
          login: { password: 'interactivepass', username: 'user@test.com' },
        },
      ],
    };

    const exportPassword = 'my-interactive-pw';
    const encrypted = generateEncryptedExport(
      JSON.stringify(vault),
      exportPassword,
      { kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0) },
    );
    fs.writeFileSync(inputPath, encrypted, 'utf-8');

    const fakeStdin = createFakeStdin();

    const origOn = fakeStdin.on.bind(fakeStdin);
    let dataListenerAttached = false;
    fakeStdin.on = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      origOn(event, listener);
      if (event === 'data' && !dataListenerAttached) {
        dataListenerAttached = true;
        process.nextTick(() => {
          [...exportPassword].forEach((char) => {
            fakeStdin.emit('data', char);
          });
          fakeStdin.emit('data', '\n');
        });
      }
      return fakeStdin;
    }) as typeof fakeStdin.on;

    const origStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, writable: true, configurable: true });

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      const result = await readJsonInputFile(inputPath) as unknown as NestedPasswordObject[];
      expect(result).toHaveLength(1);
      expect(result[0].login.password).toBe('interactivepass');

      const output = writeSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('*'.repeat(exportPassword.length));
    } finally {
      writeSpy.mockRestore();
      Object.defineProperty(process, 'stdin', { value: origStdin, writable: true, configurable: true });
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('resolves null and exits when user presses ESC during interactive prompt', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-input-esc-'));
    const inputPath = path.join(tmpDir, 'encrypted.json');

    const encrypted = generateEncryptedExport(
      JSON.stringify({ items: [{ type: 1, name: 'T', login: { password: 'p', username: 'u' } }] }),
      'pw',
      { kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0) },
    );
    fs.writeFileSync(inputPath, encrypted, 'utf-8');

    const fakeStdin = createFakeStdin();

    const origOn = fakeStdin.on.bind(fakeStdin);
    fakeStdin.on = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      origOn(event, listener);
      if (event === 'data') {
        process.nextTick(() => { listener('\u001b'); });
      }
      return fakeStdin;
    }) as typeof fakeStdin.on;

    const origStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, writable: true, configurable: true });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit-130'); }) as never);

    try {
      await expect(readJsonInputFile(inputPath)).rejects.toThrow('exit-130');
      expect(exitSpy).toHaveBeenCalledWith(130);
    } finally {
      exitSpy.mockRestore();
      Object.defineProperty(process, 'stdin', { value: origStdin, writable: true, configurable: true });
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('calls process.exit(130) when user presses Ctrl+C during interactive prompt', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-input-ctrlc-'));
    const inputPath = path.join(tmpDir, 'encrypted.json');

    const encrypted = generateEncryptedExport(
      JSON.stringify({ items: [{ type: 1, name: 'T', login: { password: 'p', username: 'u' } }] }),
      'pw',
      { kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0) },
    );
    fs.writeFileSync(inputPath, encrypted, 'utf-8');

    const fakeStdin = createFakeStdin();

    const origOn = fakeStdin.on.bind(fakeStdin);
    fakeStdin.on = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      origOn(event, listener);
      if (event === 'data') {
        process.nextTick(() => { listener('\u0003'); });
      }
      return fakeStdin;
    }) as typeof fakeStdin.on;

    const origStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, writable: true, configurable: true });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

    try {
      const promise = readJsonInputFile(inputPath);
      await vi.waitFor(() => {
        expect(exitSpy).toHaveBeenCalledWith(130);
      }, 5000);
      promise.catch(() => {});
    } finally {
      exitSpy.mockRestore();
      Object.defineProperty(process, 'stdin', { value: origStdin, writable: true, configurable: true });
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('handles backspace in raw mode during interactive prompt', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-input-backspace-'));
    const inputPath = path.join(tmpDir, 'encrypted.json');

    const exportPw = 'correct';
    const encrypted = generateEncryptedExport(
      JSON.stringify({ items: [{ type: 1, name: 'T', login: { password: 'p', username: 'u' } }] }),
      exportPw,
      { kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0) },
    );
    fs.writeFileSync(inputPath, encrypted, 'utf-8');

    const fakeStdin = createFakeStdin();

    const origOn = fakeStdin.on.bind(fakeStdin);
    fakeStdin.on = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      origOn(event, listener);
      if (event === 'data') {
        process.nextTick(() => {
          [...'wrong'].forEach((ch) => { listener(ch); });
          [...'\b'.repeat(5)].forEach((ch) => { listener(ch); });
          [...'correct'].forEach((ch) => { listener(ch); });
          listener('\n');
        });
      }
      return fakeStdin;
    }) as typeof fakeStdin.on;

    const origStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, writable: true, configurable: true });
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      const result = await readJsonInputFile(inputPath) as unknown as NestedPasswordObject[];
      expect(result).toHaveLength(1);
      const output = writeSpy.mock.calls.map((ch) => String(ch[0])).join('');
      expect(output).toContain('*'.repeat(exportPw.length));
    } finally {
      writeSpy.mockRestore();
      Object.defineProperty(process, 'stdin', { value: origStdin, writable: true, configurable: true });
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('handles interactive prompt in non-TTY mode (no raw mode, no asterisks)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-input-nontty-'));
    const inputPath = path.join(tmpDir, 'encrypted.json');

    const exportPw = 'secret';
    const encrypted = generateEncryptedExport(
      JSON.stringify({ items: [{ type: 1, name: 'T', login: { password: 'p', username: 'u' } }] }),
      exportPw,
      { kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0) },
    );
    fs.writeFileSync(inputPath, encrypted, 'utf-8');

    const fakeStdin = createFakeStdin({ tty: false });

    const origOn = fakeStdin.on.bind(fakeStdin);
    fakeStdin.on = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      origOn(event, listener);
      if (event === 'data') {
        process.nextTick(() => {
          [...'abc'].forEach((ch) => { listener(ch); });
          [...'\b'.repeat(3)].forEach((ch) => { listener(ch); });
          [...'secret'].forEach((ch) => { listener(ch); });
          listener('\n');
        });
      }
      return fakeStdin;
    }) as typeof fakeStdin.on;

    const origStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, writable: true, configurable: true });

    try {
      const result = await readJsonInputFile(inputPath) as unknown as NestedPasswordObject[];
      expect(result).toHaveLength(1);
    } finally {
      Object.defineProperty(process, 'stdin', { value: origStdin, writable: true, configurable: true });
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('calls process.exit(130) on Ctrl+C in non-TTY mode', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-input-nontty-ctrlc-'));
    const inputPath = path.join(tmpDir, 'encrypted.json');

    const encrypted = generateEncryptedExport(
      JSON.stringify({ items: [{ type: 1, name: 'T', login: { password: 'p', username: 'u' } }] }),
      'pw',
      { kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0) },
    );
    fs.writeFileSync(inputPath, encrypted, 'utf-8');

    const fakeStdin = createFakeStdin({ tty: false });

    const origOn = fakeStdin.on.bind(fakeStdin);
    fakeStdin.on = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      origOn(event, listener);
      if (event === 'data') {
        process.nextTick(() => { listener('\u0003'); });
      }
      return fakeStdin;
    }) as typeof fakeStdin.on;

    const origStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, writable: true, configurable: true });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

    try {
      const promise = readJsonInputFile(inputPath);
      await vi.waitFor(() => {
        expect(exitSpy).toHaveBeenCalledWith(130);
      }, 5000);
      promise.catch(() => {});
    } finally {
      exitSpy.mockRestore();
      Object.defineProperty(process, 'stdin', { value: origStdin, writable: true, configurable: true });
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('ignores backspace when password is empty (raw mode)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-input-empty-bs-'));
    const inputPath = path.join(tmpDir, 'encrypted.json');

    const exportPw = 'ok';
    const encrypted = generateEncryptedExport(
      JSON.stringify({ items: [{ type: 1, name: 'T', login: { password: 'p', username: 'u' } }] }),
      exportPw,
      { kdfType: 0, iterations: 600000, salt: Buffer.alloc(16, 0) },
    );
    fs.writeFileSync(inputPath, encrypted, 'utf-8');

    const fakeStdin = createFakeStdin();

    const origOn = fakeStdin.on.bind(fakeStdin);
    fakeStdin.on = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      origOn(event, listener);
      if (event === 'data') {
        process.nextTick(() => {
          [...'\b\b\b'].forEach((ch) => { listener(ch); });
          [...'ok'].forEach((ch) => { listener(ch); });
          listener('\n');
        });
      }
      return fakeStdin;
    }) as typeof fakeStdin.on;

    const origStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, writable: true, configurable: true });
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      const result = await readJsonInputFile(inputPath) as unknown as NestedPasswordObject[];
      expect(result).toHaveLength(1);
    } finally {
      writeSpy.mockRestore();
      Object.defineProperty(process, 'stdin', { value: origStdin, writable: true, configurable: true });
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
  });
});

const makeJsonSampleData = (): HashWithLeaksAndPasswordObjects[] => [
  {
    hash: 'ABC123',
    leaks: 1000,
    passwordObjects: [{ login_password: 'pass1', name: 'site1' }],
  },
];

describe('JSON output handler', () => {
  it('writes data to JSON file correctly', async () => {
    const tmpFile = path.join(os.tmpdir(), `test-output-${Date.now()}.json`);
    try {
      await writeJsonOutputFile(tmpFile, makeJsonSampleData(), { includeSecrets: true });
      const content = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
      expect(content).toHaveLength(1);
      expect(content[0].hash).toBe('ABC123');
      expect(content[0].leaks).toBe(1000);
      expect(content[0].passwordObjects[0].login_password).toBe('pass1');
      expect(content[0].passwordObjects[0].login_password_hash).toBe('ABC123');
      expect(content[0].passwordObjects[0].login_password_hash_type).toBe('sha1');
      expect(content[0].passwordObjects[0].login_password_leaks).toBe(1000);
      expect(content[0].passwordObjects[0].login_password_readable_leaks).toBe('1 000');
      expect(content[0].passwordObjects[0].login_password_compact_leaks).toBe('1K');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  it('records the active hash type in each output record', async () => {
    const tmpFile = path.join(os.tmpdir(), `test-output-ntlm-${Date.now()}.json`);
    try {
      await writeJsonOutputFile(tmpFile, makeJsonSampleData(), {
        includeSecrets: true,
        hashType: 'ntlm',
      });
      const content = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
      expect(content[0].passwordObjects[0].login_password_hash_type).toBe('ntlm');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  it('strips null/undefined/empty from nested objects', async () => {
    const data: HashWithLeaksAndPasswordObjects[] = [
      {
        hash: 'A',
        leaks: 1,
        passwordObjects: [
          {
            login: {
              password: 'p1', username: null, totp: '', uris: null,
            },
            name: 'Site',
            notes: null,
            archivedDate: undefined,
            fields: [],
            passwordHistory: [],
          } as unknown as PasswordObject,
          {
            login: { username: null },
            name: null,
          } as unknown as PasswordObject,
        ],
      },
    ];

    const tmpFile = path.join(os.tmpdir(), `test-output-strip-${Date.now()}.json`);
    try {
      await writeJsonOutputFile(tmpFile, data, { includeSecrets: true });
      const content = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
      expect(content).toHaveLength(1);
      const objs = content[0].passwordObjects;
      expect(objs).toHaveLength(2);

      const obj = objs[0];
      expect(obj.login.password).toBe('p1');
      expect(obj.login.username).toBeUndefined();
      expect(obj.login.totp).toBeUndefined();
      expect(obj.notes).toBeUndefined();
      expect(obj.archivedDate).toBeUndefined();
      expect(obj.fields).toBeUndefined();
      expect(obj.passwordHistory).toBeUndefined();
      expect(obj.login_password_hash).toBe('A');
      expect(obj.login_password_leaks).toBe(1);
      expect(obj.login_password_readable_leaks).toBe('1');
      expect(obj.login_password_compact_leaks).toBe('1');

      const obj2 = objs[1];
      expect(obj2.login).toBeUndefined();
      expect(obj2.name).toBeUndefined();
      expect(obj2.login_password_hash).toBe('A');
      expect(obj2.login_password_leaks).toBe(1);
      expect(obj2.login_password_readable_leaks).toBe('1');
      expect(obj2.login_password_compact_leaks).toBe('1');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  it('removes password object when all fields are stripped', async () => {
    const data: HashWithLeaksAndPasswordObjects[] = [
      {
        hash: 'x',
        leaks: 0,
        passwordObjects: [
          {
            login_password: 'p1',
          },
        ],
      },
    ];
    const tmpFile = path.join(os.tmpdir(), `test-output-stripped-${Date.now()}.json`);
    try {
      await writeJsonOutputFile(tmpFile, data, { includeSecrets: true });
      const content = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
      expect(content).toHaveLength(1);
      expect(content[0].passwordObjects).toHaveLength(1);
      expect(content[0].passwordObjects[0].login_password).toBe('p1');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  it('handles empty data array', async () => {
    const tmpFile = path.join(os.tmpdir(), `test-output-empty-${Date.now()}.json`);
    try {
      await writeJsonOutputFile(tmpFile, [], { includeSecrets: true });
      const content = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
      expect(content).toEqual([]);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });
});

describe('JSON output stripEmpty returns undefined', () => {
  it('filters out entry when stripEmpty returns undefined', async () => {
    const data: HashWithLeaksAndPasswordObjects[] = [
      {
        hash: undefined as unknown as string,
        leaks: NaN,
        passwordObjects: [{ login_password: '' } as PasswordObject],
      },
    ];

    const tmpFile = path.join(os.tmpdir(), `test-stripempty-${Date.now()}.json`);
    try {
      await writeJsonOutputFile(tmpFile, data, { includeSecrets: true });
      const content = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
      expect(content).toHaveLength(1);
      expect(content[0].passwordObjects).toHaveLength(1);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  it('preserves Date instances through stripEmpty', async () => {
    const testDate = new Date('2024-06-15T12:00:00.000Z');
    const data: HashWithLeaksAndPasswordObjects[] = [
      {
        hash: 'HASH123',
        leaks: 5,
        passwordObjects: [
          {
            login_password: 'p1',
            name: 'Site',
            revisionDate: testDate,
          } as unknown as PasswordObject,
        ],
      },
    ];

    const tmpFile = path.join(os.tmpdir(), `test-date-${Date.now()}.json`);
    try {
      await writeJsonOutputFile(tmpFile, data, { includeSecrets: true });
      const content = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
      expect(content).toHaveLength(1);
      expect(content[0].passwordObjects[0].revisionDate).toBe(testDate.toISOString());
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });
});

describe('JSON output secure-by-default', () => {
  it('strips passwords by default when includeSecrets is false', async () => {
    const data: HashWithLeaksAndPasswordObjects[] = [
      {
        hash: 'ABC123',
        leaks: 1000,
        passwordObjects: [{ login_password: 'pass1', name: 'site1' }],
      },
    ];
    const tmpFile = path.join(os.tmpdir(), `test-secure-${Date.now()}.json`);
    try {
      await writeJsonOutputFile(tmpFile, data);
      const content = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
      expect(content).toHaveLength(1);
      expect(content[0].passwordObjects[0]).not.toHaveProperty('login_password');
      expect(content[0].passwordObjects[0].name).toBe('site1');
      expect(content[0].passwordObjects[0].login_password_hash).toBe('ABC123');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  it('includes passwords when includeSecrets is true', async () => {
    const data: HashWithLeaksAndPasswordObjects[] = [
      {
        hash: 'ABC123',
        leaks: 1000,
        passwordObjects: [{ login_password: 'pass1', name: 'site1' }],
      },
    ];
    const tmpFile = path.join(os.tmpdir(), `test-insecure-${Date.now()}.json`);
    try {
      await writeJsonOutputFile(tmpFile, data, { includeSecrets: true });
      const content = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
      expect(content).toHaveLength(1);
      expect(content[0].passwordObjects[0].login_password).toBe('pass1');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });

  it('strips nested login secrets by default', async () => {
    const data: HashWithLeaksAndPasswordObjects[] = [
      {
        hash: 'ABC123',
        leaks: 1000,
        passwordObjects: [
          {
            login: {
              password: 'secret',
              totp: 'otpauth://totp/example',
              fido2Credentials: [{ id: 'abc' }],
              username: 'user',
              uris: [{ uri: 'https://example.com' }],
            },
            name: 'Site',
            passwordHistory: [{ password: 'old' }],
          } as unknown as PasswordObject,
        ],
      },
    ];
    const tmpFile = path.join(os.tmpdir(), `test-nested-secure-${Date.now()}.json`);
    try {
      await writeJsonOutputFile(tmpFile, data);
      const content = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
      expect(content).toHaveLength(1);
      const { login } = content[0].passwordObjects[0];
      expect(login).not.toHaveProperty('password');
      expect(login).not.toHaveProperty('totp');
      expect(login).not.toHaveProperty('fido2Credentials');
      expect(login.username).toBe('user');
      expect(login.uris).toEqual([{ uri: 'https://example.com' }]);
      expect(content[0].passwordObjects[0]).not.toHaveProperty('passwordHistory');
      expect(content[0].passwordObjects[0].name).toBe('Site');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  });
});
