import path from 'path';
import readCsvInputFile, { validateSinglePasswordObject } from '../src/handlers/csv/input';

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
