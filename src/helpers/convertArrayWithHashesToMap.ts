import { passwordObject, passwordObjectWithHash } from '../interfaces/types';

export default (
  arrayWithHashes: Array<Readonly<passwordObjectWithHash>>,
): Map<string, Array<Readonly<passwordObject>>> => {
  const map: Map<string, Array<Readonly<passwordObject>>> = new Map();
  arrayWithHashes.forEach((objWithHash) => {
    const existingValue = map.get(objWithHash.hash);
    if (existingValue) {
      map.set(objWithHash.hash, [
        ...structuredClone(existingValue),
        structuredClone(objWithHash.passwordObject),
      ]);
    } else {
      map.set(objWithHash.hash, [structuredClone(objWithHash.passwordObject)]);
    }
  });
  return map;
};
