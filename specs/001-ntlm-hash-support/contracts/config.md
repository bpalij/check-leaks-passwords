# Contracts: Configuration

## Environment Variables

### HASH_TYPE
- **Values**: `auto` (default), `sha1`, `ntlm`
- **Behavior**:
  - `auto`: Detect hash type from local corpus. For API mode, auto resolves to `sha1` with notice.
  - `sha1`: Force SHA-1 mode
  - `ntlm`: Force NTLM mode
- **Validation**: Must be one of the valid values
- **API-mode notice (required)**: when `HASH_TYPE=auto` (default) and API mode is
  active, emit to **stderr** and echo in the console summary a line stating that
  `auto` does not apply to API mode, that SHA-1 is being used, and how to select
  NTLM (`HASH_TYPE=ntlm`).

### HASH_TYPE_MISMATCH
- **Values**: `error` (default), `warn`
- **Behavior**:
  - `error`: Abort on mismatch between requested and detected hash type
  - `warn`: Warn and self-correct to detected type
- **Validation**: Must be one of the valid values

## Config Interface Extension

Extend `ConfigInterface` in `src/types.ts`:
```ts
export type HashType = 'sha1' | 'ntlm' | 'auto';
export type HashTypeMismatchMode = 'error' | 'warn';

export interface ConfigInterface {
  // ... existing fields
  hashType: HashType;
  hashTypeMismatch: HashTypeMismatchMode;
}
```
