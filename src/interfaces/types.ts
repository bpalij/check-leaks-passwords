export interface FlatPasswordObject {
  login_password: string;
  folderName?: string;
  login_uris?: string[];
  login_username?: string;
  login_totp?: string;
  type?: number;
  typeLabel?: string;
  reprompt?: number;
  repromptLabel?: string;
  passwordAgeDays?: number;
  hasTotp?: boolean;
  hasPasskey?: boolean;
  uriCount?: number;
  hasCustomFields?: boolean;
  organizationId?: string;
  revisionDate?: string;
  creationDate?: string;
  deletedDate?: string;
  name?: string;
  notes?: string;
  favorite?: boolean;
  archivedDate?: string;
  [key: string]: unknown;
}

export interface NestedPasswordObject {
  id?: string;
  folderId?: string;
  folderName?: string;
  organizationId?: string;
  collectionIds?: string[];
  favorite: boolean;
  type: number;
  typeLabel: string;
  name?: string;
  notes?: string | null;
  fields?: Array<Record<string, unknown>> | null;
  reprompt: number;
  repromptLabel: string;
  revisionDate?: string;
  creationDate?: string;
  deletedDate?: string | null;
  archivedDate?: string | null;
  passwordHistory?: Array<Record<string, unknown>> | null;
  passwordAgeDays?: number;
  hasTotp?: boolean;
  hasPasskey?: boolean;
  uriCount?: number;
  hasCustomFields?: boolean;
  login: {
    password: string;
    username?: string | null;
    uris?: Array<{ uri?: string; match?: number | null }> | null;
    totp?: string | null;
    fido2Credentials?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
}

export type passwordObject = FlatPasswordObject | NestedPasswordObject;

export interface passwordObjectWithHash {
  hash: string,
  passwordObject: passwordObject,
}

export interface passwordObjectWithInjectedHash {
  login_password_hash: string,
  [key: string]: unknown,
}

export interface passwordObjectWithInjectedHashAndLeaks extends passwordObjectWithInjectedHash {
  login_password_leaks: string,
  login_password_readable_leaks: string,
  login_password_compact_leaks: string,
}

export interface hashWithPasswordObjects {
  hash: string,
  passwordObjects: Array<passwordObject>,
}

export interface hashWithLeaksAndPasswordObjects extends hashWithPasswordObjects {
  leaks: number,
  readableLeaks: string,
  compactLeaks: string,
}
