import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  detectLocalHashType,
  detectSingleFileHashType,
  detectSplitDirectoryHashType,
  resolveActiveHashInfo,
} from './detectHashType.js';

const SHA1_A = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';
const NTLM_A = '8846F7EAEE8FB117AD06BDD830B7586C';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'detect-hash-'));
}

function writeFile(dir: string, name: string, content: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

describe('detectSingleFileHashType', () => {
  it('detects sha1 from a 40-char hash part', async () => {
    const dir = tmpDir();
    const file = writeFile(dir, 'corpus.txt', `${SHA1_A}:1000\n`);
    await expect(detectSingleFileHashType(file)).resolves.toEqual({ type: 'sha1', sampleLength: 40 });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('detects ntlm from a 32-char hash part', async () => {
    const dir = tmpDir();
    const file = writeFile(dir, 'corpus.txt', `${NTLM_A}:1000\n`);
    await expect(detectSingleFileHashType(file)).resolves.toEqual({ type: 'ntlm', sampleLength: 32 });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ignores leading blank lines and CRLF/LF line endings', async () => {
    const dir = tmpDir();
    const file = writeFile(dir, 'corpus.txt', `\r\n\n  \r\n${NTLM_A}:5\r\n`);
    await expect(detectSingleFileHashType(file)).resolves.toEqual({ type: 'ntlm', sampleLength: 32 });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('handles a small file without a trailing newline', async () => {
    const dir = tmpDir();
    const file = writeFile(dir, 'corpus.txt', `${SHA1_A}:1000`);
    await expect(detectSingleFileHashType(file)).resolves.toEqual({ type: 'sha1', sampleLength: 40 });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns unknown for an empty file', async () => {
    const dir = tmpDir();
    const file = writeFile(dir, 'corpus.txt', '');
    await expect(detectSingleFileHashType(file)).resolves.toEqual({ type: 'unknown' });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns unknown for an all-blank file', async () => {
    const dir = tmpDir();
    const file = writeFile(dir, 'corpus.txt', '\n\r\n   \n');
    await expect(detectSingleFileHashType(file)).resolves.toEqual({ type: 'unknown' });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns ambiguous for a malformed hash-part length', async () => {
    const dir = tmpDir();
    const file = writeFile(dir, 'corpus.txt', 'ABC123:1000\n');
    await expect(detectSingleFileHashType(file)).resolves.toEqual({ type: 'ambiguous', sampleLength: 6 });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('detects mixed lengths within one file as ambiguous', async () => {
    const dir = tmpDir();
    const file = writeFile(dir, 'corpus.txt', `${SHA1_A}:1\n${NTLM_A}:2\n`);
    await expect(detectSingleFileHashType(file)).resolves.toEqual({ type: 'ambiguous' });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('never derives the type from the file name', async () => {
    const dir = tmpDir();
    const file = writeFile(dir, 'CBFDA.txt', `${NTLM_A}:1\n`);
    await expect(detectSingleFileHashType(file)).resolves.toEqual({ type: 'ntlm', sampleLength: 32 });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('detectSplitDirectoryHashType', () => {
  it('detects sha1 from 35-char suffixes', async () => {
    const dir = tmpDir();
    writeFile(dir, 'CBFDA', `${SHA1_A.slice(5)}:1000\n`);
    await expect(detectSplitDirectoryHashType(dir)).resolves.toEqual({ type: 'sha1', sampleLength: 35 });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('detects ntlm from 27-char suffixes', async () => {
    const dir = tmpDir();
    writeFile(dir, '8846F', `${NTLM_A.slice(5)}:1000\n`);
    await expect(detectSplitDirectoryHashType(dir)).resolves.toEqual({ type: 'ntlm', sampleLength: 27 });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns unknown when all prefix files are empty', async () => {
    const dir = tmpDir();
    writeFile(dir, 'AAAAA', '');
    writeFile(dir, 'BBBBB', '');
    await expect(detectSplitDirectoryHashType(dir)).resolves.toEqual({ type: 'unknown' });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns ambiguous when prefix files mix hash types', async () => {
    const dir = tmpDir();
    writeFile(dir, 'AAAAA', `${SHA1_A.slice(5)}:1\n`);
    writeFile(dir, 'BBBBB', `${NTLM_A.slice(5)}:1\n`);
    await expect(detectSplitDirectoryHashType(dir)).resolves.toEqual({ type: 'ambiguous' });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns ambiguous for a malformed suffix length (FR-012: no guessing)', async () => {
    const dir = tmpDir();
    writeFile(dir, 'AAAAA', `${'A'.repeat(20)}:1\n`);
    await expect(detectSplitDirectoryHashType(dir)).resolves.toEqual({ type: 'ambiguous', sampleLength: 20 });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ignores blank lines and CRLF when sampling split files', async () => {
    const dir = tmpDir();
    writeFile(dir, '8846F', `\r\n  \r\n${NTLM_A.slice(5)}:5\r\n`);
    await expect(detectSplitDirectoryHashType(dir)).resolves.toEqual({ type: 'ntlm', sampleLength: 27 });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('detectLocalHashType', () => {
  it('routes files to single-file detection and directories to split detection', async () => {
    const dir = tmpDir();
    const file = writeFile(dir, 'corpus.txt', `${NTLM_A}:1\n`);
    await expect(detectLocalHashType(file)).resolves.toEqual({ type: 'ntlm', sampleLength: 32 });

    const splitDir = tmpDir();
    writeFile(splitDir, 'CBFDA', `${SHA1_A.slice(5)}:1\n`);
    await expect(detectLocalHashType(splitDir)).resolves.toEqual({ type: 'sha1', sampleLength: 35 });

    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(splitDir, { recursive: true, force: true });
  });

  it('throws an explicit error for an unreadable corpus path', async () => {
    await expect(detectLocalHashType('/nonexistent/corpus/path'))
      .rejects.toThrow('Unable to read corpus for hash-type detection');
  });
});

describe('resolveActiveHashInfo', () => {
  it('auto + detected type uses the detected type', () => {
    const { info } = resolveActiveHashInfo({
      requested: 'auto',
      mismatchMode: 'error',
      isApiMode: false,
      detected: { type: 'ntlm', sampleLength: 32 },
    });
    expect(info).toMatchObject({
      requested: 'auto', type: 'ntlm', fullHashLength: 32, apiSuffixLength: 27, source: 'detected',
    });
  });

  it('explicit type matching detection is explicit', () => {
    const { info } = resolveActiveHashInfo({
      requested: 'sha1',
      mismatchMode: 'error',
      isApiMode: false,
      detected: { type: 'sha1', sampleLength: 40 },
    });
    expect(info).toMatchObject({
      type: 'sha1', source: 'explicit', fullHashLength: 40, apiSuffixLength: 35,
    });
  });

  it('explicit mismatch in error mode aborts naming requested and detected', () => {
    expect(() => resolveActiveHashInfo({
      requested: 'ntlm',
      mismatchMode: 'error',
      isApiMode: false,
      detected: { type: 'sha1', sampleLength: 40 },
    })).toThrow('HASH_TYPE=ntlm was requested, but the corpus contains sha1 hashes');
  });

  it('explicit mismatch in warn mode self-corrects', () => {
    const { info, warning } = resolveActiveHashInfo({
      requested: 'ntlm',
      mismatchMode: 'warn',
      isApiMode: false,
      detected: { type: 'sha1', sampleLength: 40 },
    });
    expect(info.type).toBe('sha1');
    expect(info.source).toBe('corrected');
    expect(warning).toContain('auto-correcting to sha1');
  });

  it('unknown detection aborts in both modes', () => {
    (['error', 'warn'] as const).forEach((mismatchMode) => {
      expect(() => resolveActiveHashInfo({
        requested: 'auto', mismatchMode, isApiMode: false, detected: { type: 'unknown' },
      })).toThrow('no non-empty hash lines');
      expect(() => resolveActiveHashInfo({
        requested: 'sha1', mismatchMode, isApiMode: false, detected: { type: 'unknown' },
      })).toThrow('no non-empty hash lines');
    });
  });

  it('ambiguous detection aborts in both modes', () => {
    (['error', 'warn'] as const).forEach((mismatchMode) => {
      expect(() => resolveActiveHashInfo({
        requested: 'auto', mismatchMode, isApiMode: false, detected: { type: 'ambiguous' },
      })).toThrow('mixes hash types');
    });
  });

  it('API + auto resolves to sha1 with a notice', () => {
    const { info, notice } = resolveActiveHashInfo({
      requested: 'auto', mismatchMode: 'error', isApiMode: true,
    });
    expect(info.type).toBe('sha1');
    expect(info.apiSuffixLength).toBe(35);
    expect(notice).toContain('HASH_TYPE=auto');
  });

  it('API + ntlm resolves to ntlm without a notice', () => {
    const { info, notice } = resolveActiveHashInfo({
      requested: 'ntlm', mismatchMode: 'error', isApiMode: true,
    });
    expect(info.type).toBe('ntlm');
    expect(info.apiSuffixLength).toBe(27);
    expect(notice).toBeUndefined();
  });
});
