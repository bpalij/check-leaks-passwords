import { passwordObject, passwordObjectWithHash } from '../interfaces/types';
import deepCopy from './deepCopy';

export default (
  arrayWithHashes: Array<Readonly<passwordObjectWithHash>>,
): Map<string, Array<Readonly<passwordObject>>> => {
  const map: Map<string, Array<Readonly<passwordObject>>> = new Map();
  arrayWithHashes.forEach((objWithHash) => {
    if (map.has(objWithHash.hash)) {
      const alreadyInMap = map.get(objWithHash.hash);
      if (alreadyInMap) {
        map.set(objWithHash.hash, [
          ...deepCopy(alreadyInMap),
          deepCopy(objWithHash.passwordObject),
        ]);
      } else {
        map.set(objWithHash.hash, [deepCopy(objWithHash.passwordObject)]);
      }
    } else {
      map.set(objWithHash.hash, [deepCopy(objWithHash.passwordObject)]);
    }
  });
  return map;
};
