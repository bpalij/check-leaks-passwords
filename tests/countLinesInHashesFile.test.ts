import path from 'path';
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
});
