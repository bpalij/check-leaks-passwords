import path from 'path';
import readJsonInputFile from '../src/handlers/json/input';
import type { NestedPasswordObject } from '../src/interfaces/types';

const fixturesDir = path.resolve(__dirname, 'fixtures');

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
});
