import { validateSinglePasswordObject } from '../src/handlers/csv/input';

describe('validateSinglePasswordObject', () => {
  it('accepts a valid object with login_password string', () => {
    expect(validateSinglePasswordObject({ login_password: 'mypass', name: 'test' })).toBe(true);
  });

  it('accepts numeric values', () => {
    expect(validateSinglePasswordObject({ login_password: 'pass', type: 1 })).toBe(true);
  });

  it('accepts null values', () => {
    expect(validateSinglePasswordObject({ login_password: 'pass', notes: null })).toBe(true);
  });

  it('accepts undefined values', () => {
    expect(validateSinglePasswordObject({ login_password: 'pass', extra: undefined })).toBe(true);
  });

  it('rejects objects with no login_password', () => {
    expect(validateSinglePasswordObject({ name: 'test' })).toBe(false);
  });

  it('rejects non-object values', () => {
    expect(validateSinglePasswordObject(null)).toBe(false);
    expect(validateSinglePasswordObject(undefined)).toBe(false);
    expect(validateSinglePasswordObject('string')).toBe(false);
    expect(validateSinglePasswordObject(42)).toBe(false);
  });

  it('rejects objects with invalid value types', () => {
    expect(validateSinglePasswordObject({
      login_password: 'pass',
      extra: { nested: 'object' },
    })).toBe(false);
  });
});
