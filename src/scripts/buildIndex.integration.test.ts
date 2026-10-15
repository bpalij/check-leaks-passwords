import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { promisify } from 'util';

import {
  describe,
  it,
  expect,
  afterEach,
} from 'vitest';

import {
  IDX_HEADER_SIZE,
  IDX_HASH_TYPE_NTLM,
  IDX_VERSION_V3,
  SMALL_FILE_BYTES_THRESHOLD,
} from '../constants.js';

const execFileAsync = promisify(execFile);

const GIB = 1024 * 1024 * 1024;

/** ~1.07 GiB — comfortably above the 1 GiB sortedness threshold. */
const LARGE_CORPUS_BYTES = Math.ceil((1.07 * GIB) / 43) * 43;

const REPEAT_CHUNK_BYTES = 16 * 1024 * 1024;

/**
 * Write a corpus of one repeated 43-byte line (non-decreasing hashes) via
 * chunked writes — cheap to generate yet large enough to pass the threshold.
 *
 * @param filePath - Destination path.
 * @param line - The repeated line (must end with '\n').
 * @param totalBytes - Exact corpus size.
 */
async function writeRepeatedCorpus(
  filePath: string,
  line: string,
  totalBytes: number,
): Promise<void> {
  const copies = Math.ceil(REPEAT_CHUNK_BYTES / line.length);
  const chunk = Buffer.from(line.repeat(copies), 'ascii');
  const fd = await fs.promises.open(filePath, 'w');
  try {
    let written = 0;
    while (written < totalBytes) {
      const n = Math.min(chunk.length, totalBytes - written);
      // eslint-disable-next-line no-await-in-loop
      await fd.write(chunk, 0, n);
      written += n;
    }
  } finally {
    await fd.close();
  }
}

/**
 * Write two internally sorted halves in reverse order (F-hashes then 0-hashes).
 *
 * @param filePath - Destination path.
 * @param totalBytes - Exact corpus size.
 */
async function writeReversedHalvesCorpus(filePath: string, totalBytes: number): Promise<void> {
  const half = Math.floor(totalBytes / 2 / 43) * 43;
  await writeRepeatedCorpus(filePath, `${'F'.repeat(40)}:1\n`, half);
  const fd = await fs.promises.open(filePath, 'a');
  try {
    const line = `${'0'.repeat(40)}:1\n`;
    const copies = Math.ceil(REPEAT_CHUNK_BYTES / line.length);
    const chunk = Buffer.from(line.repeat(copies), 'ascii');
    let written = half;
    while (written < totalBytes) {
      const n = Math.min(chunk.length, totalBytes - written);
      // eslint-disable-next-line no-await-in-loop
      await fd.write(chunk, 0, n);
      written += n;
    }
  } finally {
    await fd.close();
  }
}

/**
 * Create the JSON config file the index builder falls back to.
 *
 * @param dir - Temporary directory.
 * @param hashFile - Corpus path.
 */
function writeConfig(dir: string, hashFile: string): void {
  const configDir = path.join(dir, 'config');
  fs.mkdirSync(configDir);
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify({
      inputPath: path.join(dir, 'dummy.csv'),
      hashesOfLeaksPath: hashFile,
      useHibpApi: false,
      singleFileReadMode: 'auto',
      buildIndex: false,
      outputs: [{ format: 'json', path: path.join(dir, 'out.json') }],
    }),
    'utf-8',
  );
}

/**
 * Run the buildIndex CLI as a child process.
 *
 * @param hashFile - Corpus path argument.
 * @returns stdout/stderr on success.
 */
async function runBuildIndex(hashFile: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('npx', [
    'tsx',
    'src/scripts/buildIndex.ts',
    hashFile,
  ], {
    cwd: path.resolve(__dirname, '../..'),
    timeout: 150_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, NODE_NO_WARNINGS: '1', HASH_TYPE: 'auto' },
  });
}

describe('buildIndex — child process integration', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    tmpDirs.forEach((dir) => {
      try { fs.rmSync(dir, { recursive: true }); } catch { /* ignore */ }
    });
    tmpDirs.length = 0;
  });

  function makeTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bidx-'));
    tmpDirs.push(dir);
    return dir;
  }

  it('creates a V3 .idx file for a sorted >= 1 GiB corpus', { timeout: 180_000 }, async () => {
    const dir = makeTmpDir();
    const hashFile = path.join(dir, 'hashes.txt');
    await writeRepeatedCorpus(hashFile, `${'0'.repeat(40)}:1\n`, LARGE_CORPUS_BYTES);
    writeConfig(dir, hashFile);

    const { stdout } = await runBuildIndex(hashFile);

    expect(stdout).toContain('Index built');
    const idxPath = `${hashFile}.idx`;
    expect(fs.existsSync(idxPath)).toBe(true);

    const idxBuf = fs.readFileSync(idxPath);
    expect(idxBuf.length).toBeGreaterThan(IDX_HEADER_SIZE);
    // v3 header: byte 1 is the version marker, byte 2 the hash-type code.
    expect(idxBuf[1]).toBe(IDX_VERSION_V3);
  });

  it('builds an NTLM-typed index for a 32-char >= 1 GiB corpus and records the hash type', { timeout: 180_000 }, async () => {
    const dir = makeTmpDir();
    const hashFile = path.join(dir, 'ntlm-hashes.txt');
    await writeRepeatedCorpus(hashFile, `${'0'.repeat(32)}:1\n`, LARGE_CORPUS_BYTES);
    writeConfig(dir, hashFile);

    const { stdout } = await runBuildIndex(hashFile);

    expect(stdout).toContain('Index built');
    const idxPath = `${hashFile}.idx`;
    const idxBuf = fs.readFileSync(idxPath);
    expect(idxBuf.length).toBeGreaterThan(IDX_HEADER_SIZE);
    expect(idxBuf[1]).toBe(IDX_VERSION_V3);
    expect(idxBuf[2]).toBe(IDX_HASH_TYPE_NTLM);
  });

  it('rejects a >= 1 GiB unsorted (reversed-halves) corpus with a not-sorted error', { timeout: 180_000 }, async () => {
    const dir = makeTmpDir();
    const hashFile = path.join(dir, 'unsorted.txt');
    await writeReversedHalvesCorpus(hashFile, LARGE_CORPUS_BYTES);
    writeConfig(dir, hashFile);

    const idxPath = `${hashFile}.idx`;
    try {
      await runBuildIndex(hashFile);
      expect.fail('Expected process to exit with error');
    } catch (err: unknown) {
      const error = err as { stderr?: string; code?: number };
      expect(error.code).toBe(1);
      expect(error.stderr ?? '').toContain('not sorted');
      expect(fs.existsSync(idxPath)).toBe(false);
    }
  });

  it('refuses a small (< 1 GiB) corpus with a distinct "cannot verify" error', { timeout: 120_000 }, async () => {
    const dir = makeTmpDir();
    const hashFile = path.join(dir, 'small.txt');
    const lines: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      lines.push(`${i.toString(16).toUpperCase().padStart(40, '0')}:${100 + i}`);
    }
    fs.writeFileSync(hashFile, `${lines.join('\n')}\n`, 'ascii');
    expect(fs.statSync(hashFile).size).toBeLessThan(SMALL_FILE_BYTES_THRESHOLD);
    writeConfig(dir, hashFile);

    const idxPath = `${hashFile}.idx`;
    try {
      await runBuildIndex(hashFile);
      expect.fail('Expected process to exit with error');
    } catch (err: unknown) {
      const error = err as { stderr?: string; code?: number };
      expect(error.code).toBe(1);
      expect(error.stderr ?? '').toContain('cannot verify sortedness below 1 GiB');
      expect(error.stderr ?? '').not.toContain('is not sorted');
      expect(fs.existsSync(idxPath)).toBe(false);
    }
  });
});
