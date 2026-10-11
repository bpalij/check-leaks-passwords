import { describe, it, expect } from 'vitest';

import { stripSensitiveFields } from './stripSensitiveFields.js';

describe('stripSensitiveFields', () => {
  it('strips password from flat object', () => {
    const obj = { login_password: 'secret', name: 'test', login_username: 'user' };
    const result = stripSensitiveFields(obj);
    expect(result).toEqual({ name: 'test', login_username: 'user' });
    expect(result).not.toHaveProperty('login_password');
  });

  it('strips totp from flat object', () => {
    const obj = { login_totp: 'otpauth://totp/example', name: 'test' };
    const result = stripSensitiveFields(obj);
    expect(result).toEqual({ name: 'test' });
    expect(result).not.toHaveProperty('login_totp');
  });

  it('strips fido2Credentials from flat object', () => {
    const obj = { login_fido2Credentials: [{ id: 'abc' }], name: 'test' };
    const result = stripSensitiveFields(obj);
    expect(result).toEqual({ name: 'test' });
    expect(result).not.toHaveProperty('login_fido2Credentials');
  });

  it('strips passwordHistory from flat object', () => {
    const obj = { passwordHistory: [{ password: 'old' }], name: 'test' };
    const result = stripSensitiveFields(obj);
    expect(result).toEqual({ name: 'test' });
    expect(result).not.toHaveProperty('passwordHistory');
  });

  it('strips sensitive fields from nested login object', () => {
    const obj = {
      login: {
        password: 'secret',
        totp: 'otpauth://totp/example',
        fido2Credentials: [{ id: 'abc' }],
        username: 'user',
        uris: [{ uri: 'https://example.com' }],
      },
      name: 'test',
      passwordHistory: [{ password: 'old' }],
    };
    const result = stripSensitiveFields(obj);
    expect(result).toEqual({
      login: {
        username: 'user',
        uris: [{ uri: 'https://example.com' }],
      },
      name: 'test',
    });
    expect(result.login).not.toHaveProperty('password');
    expect(result.login).not.toHaveProperty('totp');
    expect(result.login).not.toHaveProperty('fido2Credentials');
    expect(result).not.toHaveProperty('passwordHistory');
  });

  it('preserves non-sensitive fields', () => {
    const obj = {
      login_password: 'secret',
      name: 'test',
      folderName: 'Work',
      login_username: 'user',
      login_uris: ['https://example.com'],
      notes: 'some notes',
      fields: [{ name: 'f1', value: 'v1' }],
    };
    const result = stripSensitiveFields(obj);
    expect(result).toEqual({
      name: 'test',
      folderName: 'Work',
      login_username: 'user',
      login_uris: ['https://example.com'],
      notes: 'some notes',
      fields: [{ name: 'f1', value: 'v1' }],
    });
  });

  it('does not mutate the original object', () => {
    const obj = { login_password: 'secret', name: 'test' };
    const original = { ...obj };
    stripSensitiveFields(obj);
    expect(obj).toEqual(original);
  });

  it('does not mutate nested login in original object', () => {
    const login = { password: 'secret', username: 'user' };
    const obj = { login, name: 'test' };
    stripSensitiveFields(obj);
    expect(obj.login).toEqual({ password: 'secret', username: 'user' });
  });
});
