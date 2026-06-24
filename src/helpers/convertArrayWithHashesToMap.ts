import { passwordObject, passwordObjectWithHash } from '../interfaces/types';
import deepCopy from './deepCopy';

export default (
  arrayWithHashes: Array<Readonly<passwordObjectWithHash>>,
): Map<string, Array<Readonly<passwordObject>>> => {
  const map: Map<string, Array<Readonly<passwordObject>>> = new Map();
  arrayWithHashes.forEach((objWithHash) => {
    const existingValue = map.get(objWithHash.hash);
    if (existingValue) {
      map.set(objWithHash.hash, [
        ...deepCopy(existingValue),
        deepCopy(objWithHash.passwordObject),
      ]);
    } else {
      map.set(objWithHash.hash, [deepCopy(objWithHash.passwordObject)]);
    }
  });
  return map;
};
