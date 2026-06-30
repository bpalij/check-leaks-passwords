import fs from 'fs';
import { passwordObject, NestedPasswordObject } from '../../interfaces/types';

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
  fido2Credentials?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

interface BitwardenItem {
  id?: string;
  organizationId?: string;
  folderId?: string;
  collectionIds?: string[];
  favorite?: boolean;
  type?: number;
  name?: string;
  notes?: string | null;
  fields?: BitwardenField[] | null;
  reprompt?: number;
  revisionDate?: string;
  creationDate?: string;
  deletedDate?: string | null;
  archivedDate?: string | null;
  passwordHistory?: Array<Record<string, unknown>> | null;
  login?: BitwardenLogin;
}

interface BitwardenExport {
  encrypted?: boolean;
  folders?: BitwardenFolder[];
  items?: BitwardenItem[];
}

const TYPE_LABELS: Record<number, string> = {
  1: 'Login',
  2: 'Secure Note',
  3: 'Card',
  4: 'Identity',
};

const REPROMPT_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Require master password',
};

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
    .filter((x): x is BitwardenItem & { login: BitwardenLogin & { password: string } } => (
      !!x && !!x.login && !!x.login.password && typeof x.login.password === 'string'
    ))
    .map((x) => ({
      ...x,
      folderName: x.folderId ? folderMap.get(x.folderId) : undefined,
      typeLabel: TYPE_LABELS[x.type ?? 1],
      repromptLabel: REPROMPT_LABELS[x.reprompt ?? 0],
      passwordAgeDays: (() => {
        const dateStr = x.revisionDate ?? x.creationDate;
        return dateStr
          ? Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
          : undefined;
      })(),
      hasTotp: !!x.login.totp,
      hasPasskey: !!(x.login.fido2Credentials?.length),
      uriCount: x.login.uris
        ? x.login.uris.map((u) => u.uri).filter(Boolean).length
        : undefined,
      hasCustomFields: !!(x.fields?.length),
      login: {
        ...x.login,
        password: x.login.password,
        login_uris: x.login.uris ? x.login.uris.map((u) => u.uri).filter(Boolean) : undefined,
      },
    }) as NestedPasswordObject) as Array<passwordObject>;
};

export default readJsonInputFile;
