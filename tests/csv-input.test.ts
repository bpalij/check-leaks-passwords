import path from 'path';
import readCsvInputFile from '../src/handlers/csv/input';

const fixturesDir = path.resolve(__dirname, 'fixtures');

describe('CSV input handler', () => {
  it('reads a valid CSV file', async () => {
    const result = await readCsvInputFile(path.join(fixturesDir, 'sample.csv'));
    expect(result).toHaveLength(3);
    expect(result[0].login_password).toBe('password123');
    expect(result[0].login_username).toBe('user1@example.com');
    expect(result[1].login_password).toBe('letmein');
    expect(result[2].login_password).toBe('P@ssw0rd!');
  });

  it('filters out rows with empty passwords', async () => {
    const result = await readCsvInputFile(path.join(fixturesDir, 'empty.csv'));
    expect(result).toHaveLength(0);
  });

  it('rejects on rows with inconsistent column counts', async () => {
    await expect(
      readCsvInputFile(path.join(fixturesDir, 'malformed.csv')),
    ).rejects.toThrow('column header mismatch');
  });
});
