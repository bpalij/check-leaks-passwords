import path from 'path';
import fs from 'fs';
import os from 'os';

import {
  describe, it, expect, vi,
} from 'vitest';

import { binarySearchReader, findColon, cacheConfig } from './binarySearch';
import { FIXTURES_DIR } from '../../../tests/helpers/fixturesDir.js';

vi.mock('../../memory/getAvailableMemBytes.js', () => ({ getAvailableMemBytes: () => 500 * 1024 }));

const filePath = path.join(FIXTURES_DIR, 'binary-sorted-hashes.txt');
const fileSize = 2103;

function makeArgs(hash) {
  const pwMap = new Map();
  pwMap.set(hash, [{ login_password: 'pass' }]);
  const key = Buffer.from(hash, 'ascii').readUInt32BE(0);
  const map = new Map();
  map.set(key, [{ fullHash: hash, fullHashBytes: Buffer.from(hash, 'ascii') }]);
  const set = new Set([key]);
  return { map, set, pwMap };
}

describe('binarySearchReader', () => {
  it('finds matching hash', async () => {
    const { map, set, pwMap } = makeArgs('A000000000000000000000000000000000000000');
    const out = await binarySearchReader(filePath, fileSize, map, set, 'ascii', pwMap);
    expect(out).toHaveLength(1);
    expect(out[0].hash).toBe('A000000000000000000000000000000000000000');
  });

  it('returns empty when hash not present', async () => {
    const { map, set, pwMap } = makeArgs('ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ');
    const out = await binarySearchReader(filePath, fileSize, map, set, 'ascii', pwMap);
    expect(out).toHaveLength(0);
  });

  it('returns multiple matching hashes', async () => {
    const hashes = [
      'A000000000000000000000000000000000000000',
      'B000000000000000000000000000000000000000',
      'F000000000000000000000000000000000000002',
    ];
    const pwMap = new Map();
    const map = new Map();
    const set = new Set();
    hashes.forEach((hash) => {
      pwMap.set(hash, [{ login_password: 'pass' }]);
      const key = Buffer.from(hash, 'ascii').readUInt32BE(0);
      set.add(key);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ fullHash: hash, fullHashBytes: Buffer.from(hash, 'ascii') });
    });
    const out = await binarySearchReader(filePath, fileSize, map, set, 'ascii', pwMap);
    expect(out).toHaveLength(3);
  });

  it('returns empty when no hashes to check', async () => {
    const map = new Map();
    const pwMap = new Map();
    const set = new Set();
    const out = await binarySearchReader(filePath, fileSize, map, set, 'ascii', pwMap);
    expect(out).toHaveLength(0);
  });

  it('calls onProgress', async () => {
    const { map, set, pwMap } = makeArgs('B000000000000000000000000000000000000000');
    const onProgress = vi.fn();
    await binarySearchReader(filePath, fileSize, map, set, 'ascii', pwMap, undefined, onProgress);
    expect(onProgress).toHaveBeenCalled();
  });

  it('calls logger', async () => {
    const { map, set, pwMap } = makeArgs('A000000000000000000000000000000000000000');
    const logs = [];
    await binarySearchReader(filePath, fileSize, map, set, 'ascii', pwMap, (m) => { logs.push(m); });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs.some((l) => l.includes('Found'))).toBe(true);
  });

  it('triggers cache eviction when cache is full', async () => {
    const lines: string[] = [];
    const numFileHashes = 500;
    for (let i = 0; i < numFileHashes; i += 1) {
      const hex = i.toString(16).padStart(40, '0');
      lines.push(`${hex}:${i + 1}`);
    }
    lines.sort();
    const content = `${lines.join('\n')}\n`;
    const tmpFile = path.join(os.tmpdir(), `test-cache-eviction-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, content);

    try {
      const hashesToSearch: string[] = [];
      for (let i = 0; i < 200; i += 1) {
        const idx = Math.floor((i * numFileHashes) / 200);
        hashesToSearch.push(idx.toString(16).padStart(40, '0'));
      }

      const pwMap = new Map();
      const map = new Map();
      const set = new Set();
      hashesToSearch.forEach((hash) => {
        pwMap.set(hash, [{ login_password: 'pass' }]);
        const key = Buffer.from(hash, 'ascii').readUInt32BE(0);
        set.add(key);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push({ fullHash: hash, fullHashBytes: Buffer.from(hash, 'ascii') });
      });

      const out = await binarySearchReader(tmpFile, content.length, map, set, 'ascii', pwMap);
      expect(out.length).toBeGreaterThan(0);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('logs and re-throws on read failure', async () => {
    const { map, set, pwMap } = makeArgs('A000000000000000000000000000000000000000');
    const logs: string[] = [];
    const mockRead = vi.fn().mockRejectedValue(new Error('disk error'));
    const mockClose = vi.fn().mockResolvedValue(undefined);
    const mockFd = {
      read: mockRead,
      close: mockClose,
      async [Symbol.asyncDispose]() { await this.close(); },
    };
    const spy = vi.spyOn(fs.promises, 'open').mockResolvedValue(mockFd as unknown as typeof fs.promises.FileHandle);

    try {
      await expect(
        binarySearchReader(filePath, fileSize, map, set, 'ascii', pwMap, (m) => { logs.push(m); }),
      ).rejects.toThrow('disk error');
      expect(logs.some((l) => l.includes('Warning') && l.includes('disk error'))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('handles \\r\\n line endings', async () => {
    const content = 'A000000000000000000000000000000000000000:1\r\nB000000000000000000000000000000000000000:2\r\n';
    const tmpFile = path.join(os.tmpdir(), `test-crlf-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, content);

    try {
      const { map, set, pwMap } = makeArgs('A000000000000000000000000000000000000000');
      const out = await binarySearchReader(tmpFile, content.length, map, set, 'ascii', pwMap);
      expect(out).toHaveLength(1);
      expect(out[0].hash).toBe('A000000000000000000000000000000000000000');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('handles \\r-only line endings (exercises findFirstNewline CR branch)', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const prefix = String.fromCharCode(0x41 + i);
      lines.push(`${prefix + '0'.repeat(39)}:${i + 1}`);
    }
    const content = lines.join('\r');
    const tmpFile = path.join(os.tmpdir(), `test-cr-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, content);

    try {
      const hash = 'F000000000000000000000000000000000000000';
      const { map, set, pwMap } = makeArgs(hash);
      const out = await binarySearchReader(tmpFile, content.length, map, set, 'ascii', pwMap);
      expect(out).toHaveLength(1);
      expect(out[0].hash).toBe(hash);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('findFirstNewline returns -1: long line forces search forward (covers line 35)', async () => {
    const longPad = 'X'.repeat(300);
    const normalA = `1${'0'.repeat(39)}:1`;
    const longLine = `3${'0'.repeat(39)}:${longPad}`;
    const normalF = `F${'0'.repeat(39)}:99`;
    const lines = [
      normalA,
      longLine,
      normalF,
    ];
    lines.sort();
    const content = `${lines.join('\n')}\n`;
    const tmpFile = path.join(os.tmpdir(), `test-longline-fwd-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, content);

    try {
      const hash = `F${'0'.repeat(39)}`;
      const { map, set, pwMap } = makeArgs(hash);
      const out = await binarySearchReader(tmpFile, content.length, map, set, 'ascii', pwMap);
      expect(out).toHaveLength(1);
      expect(out[0].hash).toBe(hash);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('findColon returns -1 when buffer has no colon in range (covers line 42)', () => {
    const buf = Buffer.from('ABCDEF0123456789 no colon here');
    expect(findColon(buf, 0, buf.length)).toBe(-1);
  });

  it('findColon returns index of colon when present in range', () => {
    const buf = Buffer.from('ABCDEF:12345');
    expect(findColon(buf, 0, buf.length)).toBe(6);
  });

  it('duplicate fullHash entries are deduped in state building (covers line 69 branch)', async () => {
    const hash = 'A000000000000000000000000000000000000000';
    const key = Buffer.from(hash, 'ascii').readUInt32BE(0);
    const map = new Map();
    map.set(key, [{ fullHash: hash, fullHashBytes: Buffer.from(hash, 'ascii') }, { fullHash: hash, fullHashBytes: Buffer.from(hash, 'ascii') }]);
    const set = new Set([key]);
    const pwMap = new Map();
    pwMap.set(hash, [{ login_password: 'pass' }]);
    const out = await binarySearchReader(filePath, fileSize, map, set, 'ascii', pwMap);
    expect(out).toHaveLength(1);
    expect(out[0].hash).toBe(hash);
  });

  it('buffer shorter than SHA1_HEX_LENGTH advances state.high (covers line 168)', async () => {
    const content = 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const tmpFile = path.join(os.tmpdir(), `test-short-buf-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, content);
    try {
      const hash = 'A000000000000000000000000000000000000000';
      const { map, set, pwMap } = makeArgs(hash);
      const out = await binarySearchReader(tmpFile, content.length, map, set, 'ascii', pwMap);
      expect(out).toHaveLength(0);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('consecutive newlines cause lineStart to point at newline (covers line 179)', async () => {
    const hashA = `1${'0'.repeat(39)}`;
    const hashF = `F${'0'.repeat(39)}`;
    const pad = 'X'.repeat(200);
    const content = `${hashA}:1\n\n${pad}${hashF}:99\n`;
    const tmpFile = path.join(os.tmpdir(), `test-consec-nl-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, content);
    try {
      const { map, set, pwMap } = makeArgs(hashF);
      const out = await binarySearchReader(tmpFile, content.length, map, set, 'ascii', pwMap);
      expect(out).toHaveLength(0);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('long line before newline leaves insufficient bytes from lineStart (covers line 180)', async () => {
    const hashA = `1${'0'.repeat(39)}`;
    const hashF = `F${'0'.repeat(39)}`;
    const filler = 'X'.repeat(255);
    const content = `${hashA}:1\n${filler}\n${hashF}:99\n`;
    const tmpFile = path.join(os.tmpdir(), `test-long-before-nl-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, content);
    try {
      const { map, set, pwMap } = makeArgs(hashF);
      const out = await binarySearchReader(tmpFile, content.length, map, set, 'ascii', pwMap);
      expect(out).toHaveLength(1);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('colon outside buffer range causes findColon -1 (covers line 185)', async () => {
    const hashA = `1${'0'.repeat(39)}`;
    const hashF = `F${'0'.repeat(39)}`;
    const filler = 'X'.repeat(177);
    const content = `${hashA}:1\n${filler}\n${hashF}:99\n`;
    const tmpFile = path.join(os.tmpdir(), `test-nocolon-range-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, content);
    try {
      const { map, set, pwMap } = makeArgs(hashF);
      const out = await binarySearchReader(tmpFile, content.length, map, set, 'ascii', pwMap);
      expect(out).toHaveLength(1);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('exercises getOrRead and triggers cache eviction (covers lines 121-126)', async () => {
    const numLines = 5000;
    const lines: string[] = [];
    for (let i = 0; i < numLines; i += 1) {
      const hex = i.toString(16).padStart(40, '0');
      lines.push(`${hex}:${'x'.repeat(210)}:${i + 1}`);
    }
    lines.sort();
    const content = `${lines.join('\n')}\n`;
    const tmpFile = path.join(os.tmpdir(), `test-cache-evict-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, content);

    try {
      const hashesToSearch: string[] = [];
      for (let i = 0; i < numLines; i += 1) {
        hashesToSearch.push(i.toString(16).padStart(40, '0'));
      }
      const pwMap = new Map();
      const map = new Map();
      const set = new Set();
      hashesToSearch.forEach((hash) => {
        pwMap.set(hash, [{ login_password: 'pass' }]);
        const key = Buffer.from(hash, 'ascii').readUInt32BE(0);
        set.add(key);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push({ fullHash: hash, fullHashBytes: Buffer.from(hash, 'ascii') });
      });

      const out = await binarySearchReader(tmpFile, content.length, map, set, 'ascii', pwMap);
      expect(out.length).toBeGreaterThan(0);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('triggers cache eviction with low maxEntries', async () => {
    const origMax = cacheConfig.maxEntries;
    try {
      cacheConfig.maxEntries = 5;

      const numLines = 200;
      const lines: string[] = [];
      for (let i = 0; i < numLines; i += 1) {
        const hex = i.toString(16).padStart(40, '0');
        lines.push(`${hex}:${i + 1}`);
      }
      lines.sort();
      const content = `${lines.join('\n')}\n`;
      const tmpFile = path.join(os.tmpdir(), `test-cache-low-${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, content);

      try {
        const hashesToSearch: string[] = [];
        for (let i = 0; i < numLines; i += 1) {
          hashesToSearch.push(i.toString(16).padStart(40, '0'));
        }
        const pwMap = new Map();
        const map = new Map();
        const set = new Set();
        hashesToSearch.forEach((hash) => {
          pwMap.set(hash, [{ login_password: 'pass' }]);
          const key = Buffer.from(hash, 'ascii').readUInt32BE(0);
          set.add(key);
          if (!map.has(key)) map.set(key, []);
          map.get(key)!.push({ fullHash: hash, fullHashBytes: Buffer.from(hash, 'ascii') });
        });

        const out = await binarySearchReader(tmpFile, content.length, map, set, 'ascii', pwMap);
        expect(out.length).toBeGreaterThan(0);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    } finally {
      cacheConfig.maxEntries = origMax;
    }
  });
});
