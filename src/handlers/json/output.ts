import fs from 'fs';
import { hashWithLeaksAndPasswordObjects } from '../../interfaces/types';

const writeJsonOutputFile = async (
  path: string,
  data: Array<hashWithLeaksAndPasswordObjects>,
): Promise<void> => {
  await fs.promises.writeFile(
    path,
    JSON.stringify(data, undefined, 2),
  );
};

export default writeJsonOutputFile;
