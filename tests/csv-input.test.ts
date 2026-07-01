import path from 'path';
import readCsvInputFile, { validateSinglePasswordObject } from '../src/handlers/csv/input';
import type { FlatPasswordObject } from '../src/interfaces/types';

const fixturesDir = path.resolve(__dirname, 'fixtures');

describe('CSV input handler', () => {
  it('reads a valid CSV file', async () => {
    const result = await readCsvInputFile(path.join(fixturesDir, 'sample.csv')) as unknown as FlatPasswordObject[];
    expect(result).toHaveLength(3);
    expect(result[0].login_password).toBe('password123');
    expect(result[0].login_username).toBe('user1@example.com');
    expect((result[0] as Record<string, unknown>).folderName).toBe('Social');
    expect(result[1].login_password).toBe('letmein');
    expect((result[1] as Record<string, unknown>).folderName).toBe('Work');
    expect(result[2].login_password).toBe('P@ssw0rd!');
    expect((result[2] as Record<string, unknown>).folderName).toBe('Finance');
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

  it('handles invalid date strings without crashing', async () => {
    const result = await readCsvInputFile(path.join(fixturesDir, 'csv-bad-date.csv'));
    expect(result).toHaveLength(1);
    expect(result[0].passwordAgeDays).toBeUndefined();
  });

  it('handles unknown type and reprompt values as undefined with uriCount', async () => {
    const result = await readCsvInputFile(path.join(fixturesDir, 'csv-edge-enrichments.csv'));
    expect(result).toHaveLength(2);
    expect(result[0].typeLabel).toBeUndefined();
    expect(result[0].repromptLabel).toBeUndefined();
    expect(result[0].uriCount).toBe(1);
    expect(result[1].type).toBe('custom');
    expect(result[1].typeLabel).toBeUndefined();
  });

  it('aggregates multiple login_uri columns into login_uris JSON array', async () => {
    const result = await readCsvInputFile(path.join(fixturesDir, 'csv-multi-uri.csv'));
    expect(result).toHaveLength(2);
    expect((result[0] as Record<string, unknown>).login_uris).toEqual(['https://example.com', 'https://x.com', 'https://y.com']);
    expect((result[0] as Record<string, unknown>).uriCount).toBe(3);
    expect((result[1] as Record<string, unknown>).login_uris).toBeUndefined();
    expect((result[1] as Record<string, unknown>).uriCount).toBeUndefined();
  });

  it('rejects when CSV header lacks login_password', async () => {
    await expect(
      readCsvInputFile(path.join(fixturesDir, 'csv-no-password.csv')),
    ).rejects.toThrow('one of rows is not valid!');
  });

  it('computes enrichments from CSV columns', async () => {
    const result = await readCsvInputFile(path.join(fixturesDir, 'csv-with-enrichments.csv'));
    expect(result).toHaveLength(2);
    expect(result[0].passwordAgeDays).toBeGreaterThan(0);
    expect(result[0].typeLabel).toBe('Login');
    expect(result[0].repromptLabel).toBe('None');
    expect(result[0].hasTotp).toBe(true);
    expect(result[0].uriCount).toBeUndefined();
    expect(result[1].passwordAgeDays).toBeGreaterThan(0);
    expect(result[1].typeLabel).toBe('Identity');
    expect(result[1].repromptLabel).toBe('Require master password');
    expect(result[1].hasTotp).toBe(false);
    expect(result[0].favorite).toBe(true);
    expect(result[1].favorite).toBe(false);
  });
});

describe('validateSinglePasswordObject', () => {
  it('returns true for a valid password object', () => {
    expect(validateSinglePasswordObject({ login_password: 'pass' })).toBe(true);
  });

  it('returns true with null and number values', () => {
    expect(validateSinglePasswordObject({ login_password: 'pass', extra: null, count: 5 })).toBe(true);
  });

  it('returns false for null', () => {
    expect(validateSinglePasswordObject(null)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(validateSinglePasswordObject('hello')).toBe(false);
  });

  it('returns false for a number', () => {
    expect(validateSinglePasswordObject(42)).toBe(false);
  });

  it('returns false when login_password is missing', () => {
    expect(validateSinglePasswordObject({ name: 'test' })).toBe(false);
  });

  it('returns false when login_password is not a string', () => {
    expect(validateSinglePasswordObject({ login_password: 123 })).toBe(false);
  });

  it('returns false for a nested object value', () => {
    expect(validateSinglePasswordObject({ login_password: 'pass', nested: { x: 1 } })).toBe(false);
  });

  it('returns false for an array value', () => {
    expect(validateSinglePasswordObject({ login_password: 'pass', items: [1, 2] })).toBe(false);
  });
});
