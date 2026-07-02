import fs, { PathLike } from 'fs';
import {
  passwordObject,
  hashWithLeaksAndPasswordObjects,
} from '../interfaces/types';
import processSingleFile from './processSingleFile';
import processSplitDirectory from './processSplitDirectory';

export default (
  hashesWithPasswordObjects: Map<string, Array<passwordObject>>,
  hashesPath: PathLike,
  encoding: BufferEncoding,
  logger?: (message: string) => void,
): Promise<Array<hashWithLeaksAndPasswordObjects>> => {
  try {
    if (fs.statSync(hashesPath).isDirectory()) {
      return processSplitDirectory(hashesWithPasswordObjects, hashesPath, encoding, logger);
    }
    return processSingleFile(
      hashesWithPasswordObjects, hashesPath, encoding, logger,
    );
  } catch (err) {
    return Promise.reject(err);
  }
};
