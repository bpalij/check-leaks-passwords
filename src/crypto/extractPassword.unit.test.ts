import { extractPassword } from './extractPassword.js';
import type { PasswordObject } from '../types.js';

describe('extractPassword', () => {
  it('extracts from flat object (login_password)', () => {
    const obj = { login_password: 'mysecret' } as PasswordObject;
    expect(extractPassword(obj)).toBe('mysecret');
  });

  it('extracts from nested object (login.password)', () => {
    const obj = { login: { password: 'mysecret', username: 'user' } } as PasswordObject;
    expect(extractPassword(obj)).toBe('mysecret');
  });

  it('returns empty string when nested login.password is undefined', () => {
    const obj = { login: { username: 'user' } } as PasswordObject;
    expect(extractPassword(obj)).toBe('');
  });

  it('returns empty string when login is null', () => {
    const obj = { login: null } as unknown as PasswordObject;
    expect(extractPassword(obj)).toBe('');
  });

  it('returns empty string when login_password is undefined', () => {
    const obj = { name: 'test' } as PasswordObject;
    expect(extractPassword(obj)).toBe('');
  });

  it('returns empty string when login_password is null', () => {
    const obj = { login_password: null } as unknown as PasswordObject;
    expect(extractPassword(obj)).toBe('');
  });

  it('returns empty string for empty password', () => {
    const obj = { login_password: '' } as PasswordObject;
    expect(extractPassword(obj)).toBe('');
  });

  it('prefers nested login.password over flat login_password when both exist', () => {
    const obj = {
      login_password: 'flatpass',
      login: { password: 'nestedpass' },
    } as PasswordObject;
    expect(extractPassword(obj)).toBe('nestedpass');
  });
});
