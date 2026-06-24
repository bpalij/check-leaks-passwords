import path from 'path';
import readJsonInputFile from '../src/handlers/json/input';

const fixturesDir = path.resolve(__dirname, 'fixtures');

describe('JSON input handler', () => {
  it('reads a valid Bitwarden JSON file', async () => {
    const result = await readJsonInputFile(path.join(fixturesDir, 'sample.json'));
    expect(result).toHaveLength(2);
    expect(result[0].login_password).toBe('password123');
    expect(result[0].folder).toBe('Social');
    expect(result[0].login_uris).toEqual(['https://example.com']);
    expect(result[1].login_password).toBe('letmein');
    expect(result[1].folder).toBe('Work');
  });

  it('returns empty array when there are no items with passwords', async () => {
    const result = await readJsonInputFile(path.join(fixturesDir, 'empty-items.json'));
    expect(result).toHaveLength(0);
  });

  it('returns empty array for missing items field', async () => {
    const result = await readJsonInputFile(path.join(fixturesDir, 'empty-items.json'));
    expect(result).toHaveLength(0);
  });

  it('returns empty array when items is null', async () => {
    const result = await readJsonInputFile(path.join(fixturesDir, 'no-items.json'));
    expect(result).toHaveLength(0);
  });

  it('reads items without folders or uris', async () => {
    const result = await readJsonInputFile(path.join(fixturesDir, 'minimal-items.json'));
    expect(result).toHaveLength(1);
    expect(result[0].login_password).toBe('minimalpass');
    expect(result[0].folder).toBeUndefined();
    expect(result[0].login_uris).toBeUndefined();
  });

  it('rejects on non-existent file', async () => {
    await expect(
      readJsonInputFile('/nonexistent/file.json'),
    ).rejects.toThrow();
  });
});
