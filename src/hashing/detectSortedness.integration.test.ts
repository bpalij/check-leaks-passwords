import fs from 'fs';

import { detectSortedness } from './detectSortedness.js';
import { makeTestFilePath } from '../../tests/helpers/testTmp.js';

/**
 * Corpus size in bytes: 96 KiB.
 *
 * The production threshold (1 GiB) is overridden to 64 KiB via
 * `SMALL_FILE_BYTES_THRESHOLD` so the live check runs on a tiny corpus. 96 KiB
 * stays comfortably above the 80 KiB non-overlap floor (20 regions x 4096 B).
 */
const CORPUS_BYTES = 96 * 1024;

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

/** UTF-8 byte-order mark bytes. */
const UTF8_BOM = Buffer.from([
  0xef,
  0xbb,
  0xbf,
]);

/**
 * Write a corpus that begins with a UTF-8 BOM followed by repeated lines.
 *
 * @param filePath - Destination path.
 * @param line - The single line to repeat (43 bytes, ends with '\n').
 * @param totalBytes - Exact total corpus size in bytes (including the BOM).
 */
async function writeBomCorpus(filePath: string, line: string, totalBytes: number): Promise<void> {
  const bodyBytes = totalBytes - UTF8_BOM.length;
  const chunk = Buffer.from(line.repeat(WRITE_CHUNK_LINES), 'ascii');
  await using fd = await fs.promises.open(filePath, 'w');
  await fd.write(UTF8_BOM, 0, UTF8_BOM.length);
  let written = 0;
  while (written < bodyBytes) {
    const n = Math.min(chunk.length, bodyBytes - written);
    // eslint-disable-next-line no-await-in-loop
    await fd.write(chunk, 0, n);
    written += n;
  }
}

/**
 * Write a BOM-prefixed corpus of two internally sorted halves in reverse order.
 *
 * @param filePath - Destination path.
 * @param totalBytes - Exact total corpus size in bytes (including the BOM).
 */
async function writeBomReversedHalvesCorpus(filePath: string, totalBytes: number): Promise<void> {
  const bodyBytes = totalBytes - UTF8_BOM.length;
  const half = Math.floor(bodyBytes / 2 / 43) * 43;
  await using fd = await fs.promises.open(filePath, 'w');
  await fd.write(UTF8_BOM, 0, UTF8_BOM.length);
  const chunkHigh = Buffer.from(HIGH_LINE.repeat(WRITE_CHUNK_LINES), 'ascii');
  const chunkLow = Buffer.from(LOW_LINE.repeat(WRITE_CHUNK_LINES), 'ascii');
  let written = 0;
  while (written < half) {
    const n = Math.min(chunkHigh.length, half - written);
    // eslint-disable-next-line no-await-in-loop
    await fd.write(chunkHigh, 0, n);
    written += n;
  }
  while (written < bodyBytes) {
    const n = Math.min(chunkLow.length, bodyBytes - written);
    // eslint-disable-next-line no-await-in-loop
    await fd.write(chunkLow, 0, n);
    written += n;
  }
}

describe('detectSortedness integration', () => {
  const tmpFiles: string[] = [];
  const savedThreshold = process.env.SMALL_FILE_BYTES_THRESHOLD;

  function makeTmpPath(name: string): string {
    const p = makeTestFilePath(`detectSortedness-${process.pid}-${Date.now()}-${name}`);
    tmpFiles.push(p);
    return p;
  }

  beforeEach(() => {
    process.env.SMALL_FILE_BYTES_THRESHOLD = '65536';
  });

  afterEach(async () => {
    if (savedThreshold === undefined) delete process.env.SMALL_FILE_BYTES_THRESHOLD;
    else process.env.SMALL_FILE_BYTES_THRESHOLD = savedThreshold;

    const paths = tmpFiles.splice(0);
    await Promise.all(paths.flatMap((p) => [fs.promises.unlink(p).catch(() => { /* already removed */ }), fs.promises.unlink(`${p}.idx`).catch(() => { /* no sidecar */ })]));
  });

  it('reports "sorted" for a genuinely sorted corpus above the threshold (SC-006)', { timeout: 120_000 }, async () => {
    const filePath = makeTmpPath('sorted.txt');
    await writeCorpus(filePath, LOW_LINE, CORPUS_BYTES);
    expect(await detectSortedness(filePath)).toBe('sorted');
  });

  it('reports "unsorted" for two sorted halves written in reverse (SC-001)', { timeout: 120_000 }, async () => {
    const filePath = makeTmpPath('reversed.txt');
    await writeReversedHalvesCorpus(filePath, CORPUS_BYTES);
    expect(await detectSortedness(filePath)).toBe('unsorted');
  });

  it('reports "sorted" for a sorted corpus with a leading UTF-8 BOM (BI-01 regression)', { timeout: 120_000 }, async () => {
    const filePath = makeTmpPath('sorted-bom.txt');
    await writeBomCorpus(filePath, LOW_LINE, CORPUS_BYTES);
    expect(await detectSortedness(filePath)).toBe('sorted');
  });

  it('reports "unsorted" for reversed halves with a leading UTF-8 BOM', { timeout: 120_000 }, async () => {
    const filePath = makeTmpPath('reversed-bom.txt');
    await writeBomReversedHalvesCorpus(filePath, CORPUS_BYTES);
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
