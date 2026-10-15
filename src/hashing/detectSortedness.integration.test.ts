import fs from 'fs';
import os from 'os';
import path from 'path';

import { detectSortedness } from './detectSortedness.js';

const GIB = 1024 * 1024 * 1024;

/** ~1.05 GiB, rounded up to a whole number of 43-byte lines. */
const CORPUS_BYTES = Math.ceil((1.05 * GIB) / 43) * 43;

/** Fixed-width line: 40-hex hash + ':1' + '\n' (43 bytes). */
const LOW_LINE = `${'0'.repeat(40)}:1\n`;
const HIGH_LINE = `${'F'.repeat(40)}:1\n`;

const WRITE_CHUNK_LINES = Math.ceil((16 * 1024 * 1024) / 43);

/**
 * Write a corpus of identical lines via chunked positioned writes.
 *
 * @param filePath - Destination path.
 * @param line - The single line to repeat (43 bytes, ends with '\n').
 * @param totalBytes - Exact corpus size in bytes.
 */
async function writeCorpus(filePath: string, line: string, totalBytes: number): Promise<void> {
  const chunk = Buffer.from(line.repeat(WRITE_CHUNK_LINES), 'ascii');
  await using fd = await fs.promises.open(filePath, 'w');
  let written = 0;
  while (written < totalBytes) {
    const n = Math.min(chunk.length, totalBytes - written);
    // eslint-disable-next-line no-await-in-loop
    await fd.write(chunk, 0, n);
    written += n;
  }
}

/**
 * Write a corpus made of two internally sorted halves in reverse order
 * (first half all F-hashes, second half all 0-hashes).
 *
 * @param filePath - Destination path.
 * @param totalBytes - Exact corpus size in bytes.
 */
async function writeReversedHalvesCorpus(filePath: string, totalBytes: number): Promise<void> {
  const half = Math.floor(totalBytes / 2 / 43) * 43;
  await using fd = await fs.promises.open(filePath, 'w');
  const chunkHigh = Buffer.from(HIGH_LINE.repeat(WRITE_CHUNK_LINES), 'ascii');
  const chunkLow = Buffer.from(LOW_LINE.repeat(WRITE_CHUNK_LINES), 'ascii');
  let written = 0;
  while (written < half) {
    const n = Math.min(chunkHigh.length, half - written);
    // eslint-disable-next-line no-await-in-loop
    await fd.write(chunkHigh, 0, n);
    written += n;
  }
  while (written < totalBytes) {
    const n = Math.min(chunkLow.length, totalBytes - written);
    // eslint-disable-next-line no-await-in-loop
    await fd.write(chunkLow, 0, n);
    written += n;
  }
}

describe('detectSortedness integration', () => {
  const tmpFiles: string[] = [];

  function makeTmpPath(name: string): string {
    const p = path.join(os.tmpdir(), `detectSortedness-${process.pid}-${Date.now()}-${name}`);
    tmpFiles.push(p);
    return p;
  }

  afterEach(async () => {
    const paths = tmpFiles.splice(0);
    await Promise.all(paths.flatMap((p) => [fs.promises.unlink(p).catch(() => { /* already removed */ }), fs.promises.unlink(`${p}.idx`).catch(() => { /* no sidecar */ })]));
  });

  it('reports "sorted" for a genuinely sorted >= 1 GiB corpus (SC-006)', { timeout: 120_000 }, async () => {
    const filePath = makeTmpPath('sorted.txt');
    await writeCorpus(filePath, LOW_LINE, CORPUS_BYTES);
    expect(await detectSortedness(filePath)).toBe('sorted');
  });

  it('reports "unsorted" for two sorted halves written in reverse (SC-001)', { timeout: 120_000 }, async () => {
    const filePath = makeTmpPath('reversed.txt');
    await writeReversedHalvesCorpus(filePath, CORPUS_BYTES);
    expect(await detectSortedness(filePath)).toBe('unsorted');
  });

  it('is deterministic: repeated runs on the same corpus yield identical verdicts (SC-003)', { timeout: 120_000 }, async () => {
    const filePath = makeTmpPath('deterministic.txt');
    await writeCorpus(filePath, LOW_LINE, CORPUS_BYTES);

    const first = await detectSortedness(filePath);
    const repeated = await Promise.all(
      [
        0,
        1,
        2,
        3,
      ].map(() => detectSortedness(filePath)),
    );
    repeated.forEach((verdict) => expect(verdict).toBe(first));
  });
});
