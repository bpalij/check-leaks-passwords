import fs from 'fs';
import path from 'path';

import { findNearestPackageJson, readPackageVersion, PACKAGE_VERSION } from './packageVersion.js';

describe('packageVersion', () => {
  let tmpRoot: string;

  beforeEach(() => {
    fs.mkdirSync('tests/__output__', { recursive: true });
    tmpRoot = path.resolve(fs.mkdtempSync(path.join('tests/__output__', 'packageversion-')));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe('findNearestPackageJson', () => {
    it('finds the nearest package.json walking up from a nested directory', () => {
      const pkgPath = path.join(tmpRoot, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify({ version: '9.8.7' }));
      const nested = path.join(tmpRoot, 'a', 'b');
      fs.mkdirSync(nested, { recursive: true });

      expect(findNearestPackageJson(nested)).toBe(pkgPath);
    });

    it('throws when package.json is deeper than maxDepth', () => {
      fs.writeFileSync(path.join(tmpRoot, 'package.json'), JSON.stringify({ version: '9.8.7' }));
      const nested = path.join(tmpRoot, 'a', 'b');
      fs.mkdirSync(nested, { recursive: true });

      // nested is 3 levels below tmpRoot: depth 0 = b, 1 = a, 2 = tmpRoot
      expect(() => findNearestPackageJson(nested, 1)).toThrow(/package\.json not found/);
      expect(findNearestPackageJson(nested, 2)).toBe(path.join(tmpRoot, 'package.json'));
    });
  });

  describe('readPackageVersion', () => {
    it('returns the version from the nearest package.json', () => {
      fs.writeFileSync(path.join(tmpRoot, 'package.json'), JSON.stringify({ version: '9.8.7' }));
      const nested = path.join(tmpRoot, 'a');
      fs.mkdirSync(nested, { recursive: true });

      expect(readPackageVersion(nested)).toBe('9.8.7');
    });

    it('throws a descriptive error for malformed package.json', () => {
      fs.writeFileSync(path.join(tmpRoot, 'package.json'), '{ not json');

      expect(() => readPackageVersion(tmpRoot, 0)).toThrow(/Failed to parse .*package\.json/);
    });

    it('throws when package.json is not a JSON object', () => {
      fs.writeFileSync(path.join(tmpRoot, 'package.json'), 'null');

      expect(() => readPackageVersion(tmpRoot, 0)).toThrow(/expected a JSON object/);
    });

    it('throws when package.json has no version field', () => {
      fs.writeFileSync(path.join(tmpRoot, 'package.json'), JSON.stringify({ name: 'x' }));

      expect(() => readPackageVersion(tmpRoot, 0)).toThrow(/Invalid "version"/);
    });

    it('throws when version is not a non-empty string', () => {
      fs.writeFileSync(path.join(tmpRoot, 'package.json'), JSON.stringify({ version: 42 }));

      expect(() => readPackageVersion(tmpRoot, 0)).toThrow(/Invalid "version"/);
    });
  });

  describe('PACKAGE_VERSION', () => {
    it('matches the repository package.json version', () => {
      const repoPkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf-8')) as {
        version: string;
      };

      expect(PACKAGE_VERSION).toBe(repoPkg.version);
    });
  });
});
