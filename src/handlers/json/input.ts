import fs from 'fs';
import { passwordObject } from '../../interfaces/types';

interface BitwardenItem {
  login?: { password?: string };
}
interface BitwardenExport {
  items?: BitwardenItem[];
}
interface ValidBitwardenItem {
  login: { password: string };
}

const readJsonInputFile = async (path: string): Promise<Array<passwordObject>> => {
  const jsonData = JSON.parse(await fs.promises.readFile(path, { encoding: 'utf-8' })) as BitwardenExport;
  if (jsonData && jsonData.items && Array.isArray(jsonData.items)) {
    return jsonData.items
      .filter((x): x is ValidBitwardenItem => (
        !!x && !!x.login && !!x.login.password && typeof x.login.password === 'string'
      ))
      .map((x) => ({ login_password: x.login.password }));
  }
  return [];
};

export default readJsonInputFile;
