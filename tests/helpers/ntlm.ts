import { md4 } from '../../src/crypto/md4.js';

export function ntlm(password: string): string {
  return md4(Buffer.from(password, 'utf16le')).toString('hex').toUpperCase();
}
