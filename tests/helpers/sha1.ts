import crypto from 'crypto';

export function sha1(password: string): string {
  return crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
}
