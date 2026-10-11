import fs from 'fs';
import path from 'path';

import { generateEncryptedExport } from '../src/crypto/generateEncryptedExport.js';

const fixturesDir = path.resolve(import.meta.dirname, '..', 'tests', 'fixtures');

const vault = {
  folders: [{ id: '1', name: 'Social' }],
  items: [
    {
      folderId: '1',
      type: 1,
      name: 'Test Site',
      login: {
        password: 'password123',
        username: 'user@example.com',
        uris: [{ uri: 'https://example.com', match: null }],
      },
    },
  ],
};

const password = 'test-password-123';
const salt = Buffer.alloc(16, 0);

const encrypted = generateEncryptedExport(JSON.stringify(vault), password, {
  kdfType: 0,
  iterations: 600000,
  salt,
});

fs.mkdirSync(fixturesDir, { recursive: true });
fs.writeFileSync(path.join(fixturesDir, 'encrypted-pbkdf2.json'), encrypted, 'utf-8');

console.log(`Generated encrypted-pbkdf2.json in ${fixturesDir}`);
console.log(`Password: ${password}`);
console.log(`Salt (base64): ${salt.toString('base64')}`);
