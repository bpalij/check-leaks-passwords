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

const execFileAsync = promisify(execFile);

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

  it('creates .idx file for a sorted hashes file', { timeout: 120_000 }, async () => {
    const dir = makeTmpDir();
    const hashFile = path.join(dir, 'hashes.txt');
    const lines: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      lines.push(`${i.toString(16).toUpperCase().padStart(40, '0')}:${100 + i}`);
    }
    fs.writeFileSync(hashFile, `${lines.join('\n')}\n`, 'ascii');

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

    const { stdout } = await execFileAsync(
      'npx',
      [
        'tsx',
        'src/scripts/buildIndex.ts',
        hashFile,
      ],
      {
        cwd: path.resolve(__dirname, '../..'),
        timeout: 90_000,
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
      },
    );

    expect(stdout).toContain('Index built');
    const idxPath = `${hashFile}.idx`;
    expect(fs.existsSync(idxPath)).toBe(true);
  });

  it('idx file has valid binary structure', { timeout: 120_000 }, async () => {
    const dir = makeTmpDir();
    const hashFile = path.join(dir, 'hashes.txt');
    const lines: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      lines.push(`${i.toString(16).toUpperCase().padStart(40, '0')}:${100 + i}`);
    }
    fs.writeFileSync(hashFile, `${lines.join('\n')}\n`, 'ascii');

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

    await execFileAsync(
      'npx',
      [
        'tsx',
        'src/scripts/buildIndex.ts',
        hashFile,
      ],
      {
        cwd: path.resolve(__dirname, '../..'),
        timeout: 90_000,
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
      },
    );

    const idxPath = `${hashFile}.idx`;
    const idxBuf = fs.readFileSync(idxPath);
    const IDX_HEADER_SIZE = 9;
    expect(idxBuf.length).toBeGreaterThan(IDX_HEADER_SIZE);
  });

  it('rejects unsorted file with error', { timeout: 120_000 }, async () => {
    const dir = makeTmpDir();
    const hashFile = path.join(dir, 'unsorted.txt');
    const lines = ['ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ:10', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:5'];
    fs.writeFileSync(hashFile, `${lines.join('\n')}\n`, 'ascii');

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

    try {
      await execFileAsync(
        'npx',
        [
          'tsx',
          'src/scripts/buildIndex.ts',
          hashFile,
        ],
        {
          cwd: path.resolve(__dirname, '../..'),
          timeout: 90_000,
          env: { ...process.env, NODE_NO_WARNINGS: '1' },
        },
      );
      expect.fail('Expected process to exit with error');
    } catch (err: unknown) {
      const error = err as { stderr?: string; code?: number };
      expect(error.stderr ?? '').toContain('not sorted');
    }
  });
});
