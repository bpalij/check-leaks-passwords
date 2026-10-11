import path from 'path';
import fs from 'fs';
import os from 'os';
import v8 from 'v8';
import { Worker } from 'worker_threads';

import { buildHashLookupMap } from '../hashing/buildLookupMap.js';
import type { ChunkResult } from './processChunk.js';
import { makeMap } from '../../tests/helpers/makeMap.js';

interface WorkerMessage {
  type: 'progress' | 'result' | 'error';
  bytes?: number;
  lines?: number;
  matched?: number;
  leaks?: number;
  data?: ChunkResult;
  message?: string;
}

const workerPath = path.resolve(__dirname, '../../dist/worker/src/io/processChunkWorker.js');

describe('processChunkWorker', () => {
  it('processes a chunk and returns results', async () => {
    const hash = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';
    const content = `${hash}:1000\n`;
    const filePath = path.join(os.tmpdir(), `test-worker-${Date.now()}.txt`);
    fs.writeFileSync(filePath, content, 'ascii');

    const map = makeMap(hash);
    const { map: hashLookupMap, set: fingerprintSet } = buildHashLookupMap(map);

    const result = await new Promise<{
      messages: WorkerMessage[];
      result: ChunkResult;
    }>((resolve, reject) => {
      const worker = new Worker(workerPath, {
        workerData: {
          desc: {
            readStart: 0,
            readEnd: content.length - 1,
            coreStart: 0,
            coreEnd: content.length,
            isLast: true,
          },
          filePath,
          serializedMap: v8.serialize(hashLookupMap),
          serializedFingerprints: v8.serialize(fingerprintSet),
          encoding: 'ascii',
        },
      });

      const messages: WorkerMessage[] = [];
      worker.on('message', (msg) => {
        messages.push(msg);
        if (msg.type === 'result') {
          worker.terminate();
          resolve({ messages, result: msg.data });
        }
        if (msg.type === 'error') {
          worker.terminate();
          reject(new Error(msg.message));
        }
      });
      worker.on('error', (err) => { worker.terminate(); reject(err); });
      worker.on('exit', (code) => {
        if (code !== 0) reject(new Error(`Worker exited ${code}`));
      });
    });

    const { messages, result: data } = result;
    expect(data.results).toHaveLength(1);
    expect(data.results[0].hash).toBe(hash);
    expect(data.results[0].leaks).toBe(1000);
    expect(messages.some((m) => m.type === 'progress')).toBe(true);

    fs.unlinkSync(filePath);
  });

  it('sends error for non-existent file', async () => {
    const hash = 'CBFDAC6008F9CAB4083784CBD1874F76618D2A97';
    const map = makeMap(hash);
    const { map: hashLookupMap, set: fingerprintSet } = buildHashLookupMap(map);

    const errMsg = await new Promise<string>((resolve, reject) => {
      const worker = new Worker(workerPath, {
        workerData: {
          desc: {
            readStart: 0, readEnd: 10, coreStart: 0, coreEnd: 10, isLast: true,
          },
          filePath: '/nonexistent/nope.txt',
          serializedMap: v8.serialize(hashLookupMap),
          serializedFingerprints: v8.serialize(fingerprintSet),
          encoding: 'ascii',
        },
      });

      worker.on('message', (msg) => {
        if (msg.type === 'error') {
          worker.terminate();
          resolve(msg.message);
        }
      });
      worker.on('error', reject);
    });

    expect(errMsg).toBeTruthy();
  });
});
