import fs from 'fs';

import { decryptBitwardenExport } from '../../crypto/decryptBitwardenExport.js';
import type { NestedPasswordObject, PasswordObject } from '../../types.js';

/** Labels for Bitwarden item types. */
const TYPE_LABELS: Record<number, string> = {
  1: 'Login',
  2: 'Secure Note',
  3: 'Card',
  4: 'Identity',
};

/** Labels for Bitwarden reprompt values. */
const REPROMPT_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Require master password',
};

/**
 * Parse a raw Bitwarden JSON export into NestedPasswordObject[].
 *
 * Maps items to the nested password object format, computes derived fields
 * (typeLabel, repromptLabel, passwordAgeDays, etc.), and filters out
 * items without passwords.
 *
 * @param rawJson - The parsed raw JSON object from a Bitwarden export.
 * @returns Array of NestedPasswordObject entries with computed fields.
 * @throws {Error} If no items array is found or no items have passwords.
 */
function parseBitwardenExport(rawJson: Record<string, unknown>): Array<NestedPasswordObject> {
  const { items } = rawJson as { items?: Array<Record<string, unknown>> };
  if (!items || !Array.isArray(items)) {
    throw new Error('No items found in the decrypted JSON file');
  }

  const folderMap = new Map<string, string>();
  const { folders } = rawJson as { folders?: Array<Record<string, unknown>> };
  if (folders) {
    folders.forEach((folder) => {
      if (folder.id && folder.name) {
        folderMap.set(String(folder.id), String(folder.name));
      }
    });
  }

  const result: Array<NestedPasswordObject> = [];

  items.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const login = item.login as Record<string, unknown> | null | undefined;
    if (!login || typeof login !== 'object') return;
    const { password } = login as { password?: unknown };
    if (typeof password !== 'string' || !password) return;

    const typeNum = Number(item.type ?? 1);
    const repromptNum = Number(item.reprompt ?? 0);
    const folderId = item.folderId != null ? String(item.folderId) : undefined;

    const passwordAgeDays = (() => {
      const dateStr = item.revisionDate ?? item.creationDate;
      return dateStr
        ? Math.floor((Date.now() - new Date(String(dateStr)).getTime()) / 86400000)
        : undefined;
    })();

    const fields = item.fields as Array<Record<string, unknown>> | null | undefined;
    const { uris } = login as {
      uris?: Array<Record<string, unknown>> | null;
    };

    result.push({
      id: item.id as string | undefined,
      folderId: folderId as string | undefined,
      folderName: folderId ? folderMap.get(folderId) : undefined,
      organizationId: item.organizationId as string | undefined,
      collectionIds: item.collectionIds as string[] | undefined,
      favorite: Boolean(item.favorite),
      type: typeNum,
      typeLabel: TYPE_LABELS[typeNum] ?? 'Login',
      name: item.name as string | undefined,
      notes: item.notes as string | null | undefined,
      fields: fields as Array<Record<string, unknown>> | null | undefined,
      reprompt: repromptNum,
      repromptLabel: REPROMPT_LABELS[repromptNum] ?? 'None',
      revisionDate: item.revisionDate as string | undefined,
      creationDate: item.creationDate as string | undefined,
      deletedDate: item.deletedDate as string | null | undefined,
      archivedDate: item.archivedDate as string | null | undefined,
      passwordHistory: item.passwordHistory as Array<Record<string, unknown>> | null | undefined,
      passwordAgeDays,
      hasTotp: Boolean(login.totp),
      hasPasskey: Array.isArray(login.fido2Credentials)
        && login.fido2Credentials.length > 0,
      uriCount: uris
        ? uris.filter((u) => u.uri).length
        : undefined,
      hasCustomFields: Array.isArray(fields) && fields.length > 0,
      login: {
        password,
        username: login.username as string | null | undefined,
        uris: uris as Array<{ uri?: string; match?: number | null }> | null | undefined,
        totp: login.totp as string | null | undefined,
        fido2Credentials: login.fido2Credentials as Array<Record<string, unknown>> | undefined,
        ...login,
        login_uris: uris
          ? uris.map((u) => u.uri).filter(Boolean) as string[]
          : undefined,
      },
    });
  });

  if (result.length === 0) {
    throw new Error('No non-empty passwords found in the input file');
  }

  return result;
}

/**
 * Prompt the user for the export password interactively.
 *
 * Supports both TTY (raw mode with asterisks) and non-TTY modes.
 * Handles backspace, ESC (exit 130), and Ctrl+C (exit 130).
 *
 * @returns The password entered by the user, or null if the user cancelled.
 *
 * @security The returned string is a plaintext password.
 *   Caller must handle lifecycle and avoid logging.
 */
function promptForPassword(): Promise<string | null> {
  return new Promise((resolve) => {
    const { isTTY } = process.stdin;
    let pw = '';

    const cleanup = () => {
      if (isTTY && typeof process.stdin.setRawMode === 'function') {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    };

    const onData = (chunk: Buffer) => {
      const str = chunk.toString();
      for (let i = 0; i < str.length; i += 1) {
        const ch = str[i];
        if (ch === '\u0003') {
          cleanup();
          process.exit(130);
          return;
        }
        if (ch === '\u001b') {
          cleanup();
          resolve(null);
          return;
        }
        if (ch === '\n' || ch === '\r') {
          cleanup();
          process.stdout.write('\n');
          resolve(pw);
          return;
        }
        if (ch === '\b' || ch === '\x7f') {
          if (pw.length > 0) {
            pw = pw.slice(0, -1);
            if (isTTY) process.stdout.write('\b \b');
          }
        } else {
          pw += ch;
          if (isTTY) process.stdout.write('*');
        }
      }
    };

    if (isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', onData);
  });
}

/**
 * Read and parse a Bitwarden JSON export file.
 *
 * Supports both plain and encrypted JSON exports. When a password is provided
 * as a parameter, it is used directly. When no password is provided and the
 * file is encrypted, the user is prompted interactively.
 *
 * Maps Bitwarden JSON items to the nested password object format with
 * computed fields (typeLabel, repromptLabel, passwordAgeDays, etc.),
 * folder mapping, and login_uris flattening.
 *
 * @param path - Path to the JSON file.
 * @param password - Optional export password for encrypted files.
 * @param onReadComplete - Callback invoked when file reading is complete.
 * @returns Array of NestedPasswordObject entries parsed from the JSON.
 * @throws {Error} If the file is invalid or contains no items with passwords.
 *
 * @security Handles plaintext export passwords. The password parameter
 *   and interactive prompt input are sensitive and must not be logged.
 */
export const readJsonInputFile = async (
  path: string,
  password?: string,
  onReadComplete?: () => void,
): Promise<Array<PasswordObject>> => {
  const fileContent = await fs.promises.readFile(path, 'utf-8');
  onReadComplete?.();

  let rawJson: Record<string, unknown>;
  try {
    rawJson = JSON.parse(fileContent) as Record<string, unknown>;
  } catch {
    throw new Error('Invalid JSON in export file');
  }

  const isEncrypted = rawJson.encKey != null || rawJson.encrypted === true;

  if (isEncrypted) {
    if (rawJson.passwordProtected === false) {
      throw new Error(
        'This is an account-restricted encrypted export'
        + ' (encrypted with your Bitwarden account key),'
        + ' not a password-protected export.'
        + ' This tool cannot decrypt account-restricted exports.\n\n'
        + 'To fix this, re-export your vault from Bitwarden:\n'
        + '  1. Go to Tools > Export vault\n'
        + '  2. Select "Password-protected" (not the default option)\n'
        + '  3. Set a password when prompted\n'
        + '  4. Use that password with --export-password'
        + ' or the EXPORT_PASSWORD env var',
      );
    }

    let exportPassword = password;
    if (!exportPassword) {
      process.stdout.write('Enter export password: ');
      const prompted = await promptForPassword();
      if (prompted === null) {
        process.exit(130);
      }
      exportPassword = prompted;
    } else {
      process.stdout.write('Using password from CLI/env var\n');
    }

    const decrypted = await decryptBitwardenExport(fileContent, exportPassword);
    try {
      rawJson = JSON.parse(decrypted) as Record<string, unknown>;
    } catch {
      throw new Error('Failed to parse decrypted JSON');
    }
  }

  if (rawJson.items === null) {
    throw new Error('No items found');
  }

  return parseBitwardenExport(rawJson);
};
