import fs from 'fs';
import { passwordObject } from '../../interfaces/types';

interface BitwardenFolder {
  id?: string;
  name?: string;
}

interface BitwardenField {
  name?: string;
  value?: string;
  type?: number;
  [key: string]: unknown;
}

interface BitwardenLogin {
  password?: string;
  username?: string | null;
  uris?: Array<{ uri?: string; match?: number | null }>;
  totp?: string | null;
}

interface BitwardenItem {
  folderId?: string;
  favorite?: boolean;
  type?: number;
  name?: string;
  notes?: string | null;
  fields?: BitwardenField[] | null;
  reprompt?: number;
  archivedDate?: string | null;
  login?: BitwardenLogin;
}

interface BitwardenExport {
  folders?: BitwardenFolder[];
  items?: BitwardenItem[];
}

interface ValidBitwardenItem {
  folderId?: string;
  favorite: boolean;
  type: number;
  name?: string;
  notes?: string | null;
  fields?: BitwardenField[] | null;
  reprompt: number;
  archivedDate?: string | null;
  login: {
    password: string;
    username?: string | null;
    uris?: Array<{ uri?: string; match?: number | null }>;
    totp?: string | null;
  };
}

const readJsonInputFile = async (path: string): Promise<Array<passwordObject>> => {
  const rawData = JSON.parse(
    await fs.promises.readFile(path, { encoding: 'utf-8' }),
  ) as BitwardenExport;

  if (!rawData || !rawData.items || !Array.isArray(rawData.items)) {
    return [];
  }

  const folderMap = new Map<string, string>();
  if (rawData.folders) {
    rawData.folders.forEach((folder) => {
      if (folder.id && folder.name) {
        folderMap.set(folder.id, folder.name);
      }
    });
  }

  return rawData.items
    .filter((x): x is ValidBitwardenItem => (
      !!x && !!x.login && !!x.login.password && typeof x.login.password === 'string'
    ))
    .map((x) => ({
      login_password: x.login.password,
      folder: x.folderId ? folderMap.get(x.folderId) : undefined,
      favorite: x.favorite,
      type: x.type,
      name: x.name,
      notes: x.notes ?? undefined,
      fields: x.fields ?? undefined,
      reprompt: x.reprompt,
      archivedDate: x.archivedDate ?? undefined,
      login_uris: x.login.uris
        ?.map((u) => u.uri)
        .filter((uri): uri is string => !!uri) ?? undefined,
      login_username: x.login.username ?? undefined,
      login_totp: x.login.totp ?? undefined,
    }));
};

export default readJsonInputFile;
