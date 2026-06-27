import path from 'path';
import fs from 'fs';
import os from 'os';
import countLinesInHashesFile from '../src/helpers/countLinesInHashesFile';

const fixturesDir = path.resolve(__dirname, 'fixtures');

describe('countLinesInHashesFile', () => {
  it('counts lines in a non-empty file', async () => {
    const lines = await countLinesInHashesFile(
      path.join(fixturesDir, 'sample-hashes.txt'),
    );
    expect(lines).toBe(3);
  });

  it('returns 0 for an empty file', async () => {
    const lines = await countLinesInHashesFile(
      path.join(fixturesDir, 'empty-hashes.txt'),
    );
    expect(lines).toBe(0);
  });

  it('works without a logger', async () => {
    const lines = await countLinesInHashesFile(
      path.join(fixturesDir, 'sample-hashes.txt'),
    );
    expect(lines).toBe(3);
  });

  it('rejects on non-existent file', async () => {
    await expect(
      countLinesInHashesFile('/nonexistent/path.txt'),
    ).rejects.toThrow();
  });

  it('returns undefined for a directory', async () => {
    const result = await countLinesInHashesFile(
      path.join(fixturesDir, 'split-hashes'),
    );
    expect(result).toBeUndefined();
  });

  it('rejects on unreadable file', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cl-'));
    const tempFile = path.join(tempDir, 'test.txt');
    fs.writeFileSync(tempFile, 'test');
    fs.chmodSync(tempFile, 0o000);
    try {
      await expect(countLinesInHashesFile(tempFile)).rejects.toThrow();
    } finally {
      fs.chmodSync(tempFile, 0o644);
      fs.unlinkSync(tempFile);
      fs.rmdirSync(tempDir);
    }
  });

  it('logs progress with avg speed and counting time', async () => {
    const logs: string[] = [];
    const mockLog = (msg: string) => { logs.push(msg); };

    await countLinesInHashesFile(
      path.join(fixturesDir, 'sample-hashes.txt'),
      mockLog,
    );

    expect(logs.some((l) => l.includes('Counted all'))).toBe(true);
    expect(logs.some((l) => l.includes('avg lines per second'))).toBe(true);
    expect(logs.some((l) => l.includes('Counting lines time:'))).toBe(true);
    expect(logs.some((l) => l.includes('Counted lines in'))).toBe(true);
  });
});
