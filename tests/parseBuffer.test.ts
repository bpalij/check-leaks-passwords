import parseBuffer from '../src/helpers/parseBuffer';
import type { hashWithLeaksAndPasswordObjects, passwordObject } from '../src/interfaces/types';

describe('parseBuffer', () => {
  const makeMap = (hash: string, objs: passwordObject[] = [{ login_password: 'pass' }]) => {
    const map = new Map<string, passwordObject[]>();
    map.set(hash, objs);
    return map;
  };

  it('returns matching hashes with leak counts', () => {
    const results: Array<hashWithLeaksAndPasswordObjects> = [];
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const buffer = Buffer.from('CBFDAC6008F9CAB4083784CBD1874F76618D2A97:1000\n');
    const stats = parseBuffer(buffer, '', map, results, 'ascii');
    expect(results).toHaveLength(1);
    expect(results[0].leaks).toBe(1000);
    expect(results[0].hash).toBe('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    expect(results[0].readableLeaks).toBe('1 000');
    expect(results[0].compactLeaks).toBe('1 K');
    expect(stats.linesProcessed).toBe(1);
    expect(stats.matchedHashCount).toBe(1);
    expect(stats.cumulativeLeakCount).toBe(1000);
  });

  it('returns empty array when no hashes match', () => {
    const results: Array<hashWithLeaksAndPasswordObjects> = [];
    const map = makeMap('NONEXISTENTHASH000000000000000000000000000');
    const buffer = Buffer.from('CBFDAC6008F9CAB4083784CBD1874F76618D2A97:1000\n');
    const stats = parseBuffer(buffer, '', map, results, 'ascii');
    expect(results).toHaveLength(0);
    expect(stats.matchedHashCount).toBe(0);
    expect(stats.cumulativeLeakCount).toBe(0);
  });

  it('returns empty array for empty buffer', () => {
    const results: Array<hashWithLeaksAndPasswordObjects> = [];
    const map = makeMap('SOMETHING');
    const buffer = Buffer.alloc(0);
    const stats = parseBuffer(buffer, '', map, results, 'ascii');
    expect(results).toHaveLength(0);
    expect(stats.linesProcessed).toBe(0);
  });

  it('rejects when hash before colon is empty', () => {
    const results: Array<hashWithLeaksAndPasswordObjects> = [];
    const map = makeMap('ANYTHING');
    const buffer = Buffer.from(':500\n');
    expect(() => parseBuffer(buffer, '', map, results, 'ascii')).toThrow(
      'empty hash before colon',
    );
  });

  it('rejects on non-numeric leak count', () => {
    const results: Array<hashWithLeaksAndPasswordObjects> = [];
    const map = makeMap('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
    const buffer = Buffer.from('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8:abc\n');
    expect(() => parseBuffer(buffer, '', map, results, 'ascii')).toThrow(
      'Invalid leak count "abc"',
    );
  });

  it('silently skips lines without colon', () => {
    const results: Array<hashWithLeaksAndPasswordObjects> = [];
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    map.set('B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3', [{ login_password: 'pass2' }]);
    const buffer = Buffer.from(
      'CBFDAC6008F9CAB4083784CBD1874F76618D2A97:1000\n'
      + 'B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3\n'
      + 'B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3:500\n',
    );
    const stats = parseBuffer(buffer, '', map, results, 'ascii');
    expect(results).toHaveLength(2);
    expect(results[0].leaks).toBe(1000);
    expect(results[1].leaks).toBe(500);
    expect(stats.linesProcessed).toBe(3);
  });

  it('silently skips empty lines', () => {
    const results: Array<hashWithLeaksAndPasswordObjects> = [];
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    map.set('B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3', [{ login_password: 'pass2' }]);
    const buffer = Buffer.from(
      'CBFDAC6008F9CAB4083784CBD1874F76618D2A97:1000\n'
      + '\n'
      + 'B7A875FC1EA228B9061041B7CEC4BD3C52AB3CE3:500\n',
    );
    const result = parseBuffer(buffer, '', map, results, 'ascii');
    expect(results).toHaveLength(2);
    expect(result.linesProcessed).toBe(3);
  });

  it('handles buffer without trailing newline', () => {
    const results: Array<hashWithLeaksAndPasswordObjects> = [];
    const map = makeMap('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
    const buffer = Buffer.from('CBFDAC6008F9CAB4083784CBD1874F76618D2A97:2000');
    const stats = parseBuffer(buffer, '', map, results, 'ascii');
    expect(results).toHaveLength(1);
    expect(results[0].leaks).toBe(2000);
    expect(stats.linesProcessed).toBe(1);
  });

  it('uses provided prefix for hash construction', () => {
    const results: Array<hashWithLeaksAndPasswordObjects> = [];
    const suffixMap = new Map<string, passwordObject[]>();
    suffixMap.set('C6008F9CAB4083784CBD1874F76618D2A97', [{ login_password: 'pass' }]);
    const buffer = Buffer.from('C6008F9CAB4083784CBD1874F76618D2A97:1000\n');
    parseBuffer(buffer, 'CBFDA', suffixMap, results, 'ascii');
    expect(results).toHaveLength(1);
    expect(results[0].hash).toBe('CBFDAC6008F9CAB4083784CBD1874F76618D2A97');
  });
});
