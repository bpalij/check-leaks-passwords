import {
  passwordObject,
  hashWithLeaksAndPasswordObjects,
} from '../interfaces/types';
import beautifullyPrintNumber from './beautifullyPrintNumber';

const NEWLINE = 0x0A;
const COLON = 0x3A;

export interface ParseBufferResult {
  linesProcessed: number;
  matchedHashCount: number;
  cumulativeLeakCount: number;
}

export default function parseBuffer(
  buffer: Buffer,
  prefix: string,
  suffixMap: Map<string, passwordObject[]>,
  results: Array<hashWithLeaksAndPasswordObjects>,
  encoding: BufferEncoding,
  fingerprintSet?: Set<number>,
): ParseBufferResult {
  let linesProcessed = 0;
  let matchedHashCount = 0;
  let cumulativeLeakCount = 0;
  let lineStartOffset = 0;

  while (lineStartOffset < buffer.length) {
    const newlinePosition = buffer.indexOf(NEWLINE, lineStartOffset);
    const lineEndOffset = newlinePosition === -1
      ? buffer.length
      : newlinePosition;

    linesProcessed += 1;

    if (lineEndOffset > lineStartOffset) {
      const lineBuffer = buffer.subarray(lineStartOffset, lineEndOffset);
      const colonPosition = lineBuffer.indexOf(COLON);

      if (colonPosition !== -1) {
        if (colonPosition === 0) {
          throw new Error('Invalid line in hashes file: empty hash before colon');
        }

        const passesFingerprint = !fingerprintSet
          || lineBuffer.length < 4
          || fingerprintSet.has(lineBuffer.readUInt32BE(0));

        if (passesFingerprint) {
          const hashSuffix = lineBuffer.subarray(0, colonPosition).toString(encoding);
          const matchingPasswordObjects = suffixMap.get(hashSuffix);

          if (matchingPasswordObjects) {
            const leakCountString = lineBuffer.subarray(colonPosition + 1).toString(encoding);
            const leakCount = parseInt(leakCountString, 10);

            if (Number.isNaN(leakCount)) {
              throw new Error(
                `Invalid leak count "${leakCountString}" for hash "${prefix + hashSuffix}"`,
              );
            }

            matchedHashCount += 1;
            cumulativeLeakCount += leakCount;

            results.push({
              hash: prefix + hashSuffix,
              leaks: leakCount,
              readableLeaks: beautifullyPrintNumber(leakCount),
              passwordObjects: matchingPasswordObjects,
            });
          }
        }
      }
    }

    if (newlinePosition === -1) break;
    lineStartOffset = newlinePosition + 1;
  }

  return { linesProcessed, matchedHashCount, cumulativeLeakCount };
}
