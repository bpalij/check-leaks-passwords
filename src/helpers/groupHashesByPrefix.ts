import { passwordObject } from '../interfaces/types';

export default function groupHashesByPrefix(
  hashesWithPasswordObjects: Map<string, Array<passwordObject>>,
  prefixLength: number,
): Map<string, Map<string, passwordObject[]>> {
  const prefixToSuffixMap = new Map<string, Map<string, passwordObject[]>>();
  Array.from(hashesWithPasswordObjects).forEach(([fullHash, passwordObjects]) => {
    const prefix = fullHash.slice(0, prefixLength).toUpperCase();
    const hashSuffix = fullHash.slice(prefixLength);

    let suffixMap = prefixToSuffixMap.get(prefix);
    if (!suffixMap) {
      suffixMap = new Map();
      prefixToSuffixMap.set(prefix, suffixMap);
    }
    suffixMap.set(hashSuffix, passwordObjects as passwordObject[]);
  });
  return prefixToSuffixMap;
}
