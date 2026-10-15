# check-leaks-passwords

Check whether passwords from a Bitwarden-compatible CSV or JSON export appear in a [HIBP](https://haveibeenpwned.com/Passwords) leaked-password hashes file, or query the HIBP k-anonymity API directly. Results are written to CSV and/or JSON. Built with a focus on scanning performance — auto-detects disk type, parallelizes reads, and chooses the optimal strategy per file.

Supports both **unencrypted** and **password-protected encrypted** Bitwarden JSON exports.

Requires Node >= 26.

## Quick Start

1. Export your passwords as CSV or JSON from a Bitwarden-compatible manager (encrypted exports are also supported — see [Encrypted Exports](#encrypted-exports)).
2. Download the SHA1 hashes list from <https://haveibeenpwned.com/Passwords> and extract the `.txt` file. (To check NTLM hashes instead, download the NTLM variant with the [Pwned Passwords Downloader](https://github.com/HaveIBeenPwned/PwnedPasswordsDownloader) and set `HASH_TYPE=ntlm` — see [Hash Types](#hash-types).)
3. Clone this repository.
4. Copy `.env.example` to `.env` and edit the values to match your paths.
5. `npm i`
6. `npm start`

## Configuration

All configuration is via environment variables (`.env` file at the project root). Copy `.env.example` to `.env` and edit the values. The tool uses `process.loadEnvFile()` (Node built-in, no extra dependencies) — `.env` is loaded automatically on startup.

CLI flags (`--include-secrets`, `--export-password`, `--dry-run`) override `.env` values, which override built-in defaults. See [Priority order](#priority-order) below.

### Config Options

| Variable | Default | Description |
| --- | --- | --- |
| `INPUT_PATH` | — | Path to your password export file (CSV or JSON). Format is auto-detected. |
| `HASHES_OF_LEAKS_PATH` | — | Path to the HIBP hashes file or split-file directory (~90 GB as of 06.2026). Required when `USE_HIBP_API=false`. |
| `USE_HIBP_API` | `false` | `false` = scan a local hashes file or split-file directory; `true` = query the HIBP API over the network. |
| `HASH_TYPE` | `auto` | Password hash algorithm: `auto`, `sha1`, or `ntlm`. See [Hash Types](#hash-types). |
| `HASH_TYPE_MISMATCH` | `error` | Behavior when the requested hash type conflicts with the detected corpus type: `error` (abort) or `warn` (self-correct). See [Hash Types](#hash-types). |
| `SINGLE_FILE_READ_MODE` | `auto` | File scanning strategy. See [Read Modes](#read-modes) below. |
| `BUILD_INDEX` | `false` | Whether to build a `.idx` prefix-index file during the scan for faster future runs. See [Read Modes](#read-modes). |
| `INCLUDE_SECRETS` | `false` | `false` (recommended) — output excludes plaintext passwords, TOTP secrets, password history, and FIDO2 credentials. `true` — output includes all secrets in plaintext on disk. ⚠️ INSECURE when `true`. |
| `EXPORT_PASSWORD` | — | Password for encrypted Bitwarden JSON exports. ⚠️ Insecure: stored as plaintext in `.env`. Prefer the interactive prompt. |
| `HIBP_API_URL` | `https://api.pwnedpasswords.com/range/` | Base URL for the HIBP k-anonymity API. Only used when `USE_HIBP_API=true`. |
| `OUTPUT_COUNT` | — | Number of output targets (at least 1). |
| `OUTPUT_{i}_FORMAT` | — | Output format for output `i` (0-indexed): `csv` or `json`. |
| `OUTPUT_{i}_PATH` | — | Output file path for output `i` (0-indexed). |

### Read Modes

The `singleFileReadMode` config field controls how the local hashes file is scanned.
The `buildIndex` boolean controls whether a `.idx` prefix-index file is built as a side-effect during the scan.

Modes marked with * require the file to be sorted lexicographically (the HIBP download is sorted). Sortedness is only verified for corpora at or above 1 GiB using deterministic cross-region sampling; the check reports `sorted`, `unsorted`, or `skipped` (below 1 GiB, no ordered/unordered claim). An `unsorted` file produces a warning and falls back to sequential; a `skipped` file logs a neutral skip notice and is read sequentially. Only `sorted` enables order-dependent reading or an `.idx` build.

| Mode | `buildIndex: false` | `buildIndex: true` |
| --- | --- | --- |
| `auto` **(default)** | Auto-detects disk type and sortedness. Picks the fastest strategy. No index built. | Same auto-detection, but builds a `.idx` index file during the scan for faster future runs. |
| `sequential` | Multi-chunk parallel sequential scan. Works on any file (sorted or not). No index built. | Multi-chunk sequential scan that builds a `.idx` index during the scan. |
| `binary` * | Binary search for each hash. Fast for small hash counts on sorted files. | Same binary search. Falls back to sequential with index build if binary is not beneficial. |
| `index` * | **Warning:** falls back to `auto` behavior without index building. | Random-read via a pre-built `.idx` file. Fastest mode for repeated runs on the same data. If no fresh `.idx` exists, the first run falls back to a sequential scan that builds the index as a side-effect; subsequent runs use the index. |

**Auto-detection logic:** For files >= 1 GB a short drive speed test runs (three 16 MB reads). Sequential throughput above 300 MB/s classifies the drive as SSD; at or below that, as HDD. SSDs get multi-chunk parallel scanning (chunk count auto-scaled to disk speed, CPU cores, and available memory). HDDs get a single chunk. Files under 1 GB skip the speed test and use one chunk. Because sortedness is only verified at or above 1 GiB, `READ_MODE_FORCED=binary`/`index`/`sequential-index` is refused on smaller files (see [`READ_MODE_FORCED` Error Behavior](#read_mode_forced-error-behavior)).

### Hash Types

By default the tool hashes passwords with **SHA-1** and checks them against the standard HIBP SHA-1 corpus. Set `HASH_TYPE=ntlm` to hash passwords with the NTLM format instead (MD4 of the UTF-16LE-encoded password), for use with the NTLM corpus produced by the official [Pwned Passwords Downloader](https://github.com/HaveIBeenPwned/PwnedPasswordsDownloader) (NTLM hashes are 32 hex characters; split-prefix suffixes are 27).

| `HASH_TYPE` | Behavior |
| --- | --- |
| `auto` **(default)** | Detect the type from corpus content: a 40-char hash part (single file) or 35-char suffix (split dir) → SHA-1; 32 / 27 → NTLM. In API mode there is no corpus to sample, so `auto` resolves to SHA-1 and prints a notice. |
| `sha1` | Force SHA-1. |
| `ntlm` | Force NTLM. |

Detection is always content-based and never uses file names. When `auto` cannot determine a single type — an empty/unreadable corpus, malformed lines, or a corpus mixing both types — the run aborts rather than guessing.

`HASH_TYPE_MISMATCH` controls what happens when an explicitly requested type conflicts with the detected corpus type:

| `HASH_TYPE_MISMATCH` | Behavior |
| --- | --- |
| `error` **(default)** | Abort before scanning with a message naming the requested and detected types. |
| `warn` | Emit a prominent warning (to stderr and the summary), self-correct to the detected type, and produce correct results. |

In both modes an ambiguous or unreadable corpus is a hard error. The effective type actually used is recorded on every result (`login_password_hash_type` in JSON and CSV) and shown in the console summary. SHA-1 behavior is unchanged when no NTLM selection is made. `.idx` index files record the hash type and file size they were built for; an index built for a different type or size is treated as stale and rebuilt.

### `READ_MODE_FORCED` Error Behavior

When the `READ_MODE_FORCED` environment variable is set, it overrides `singleFileReadMode` entirely. Order-dependent modes (`binary`, `index`, `sequential-index`) require a verified-sorted corpus: if the file is unsorted, or is below the 1 GiB sortedness threshold (verdict `skipped`), the program **stops with an error** naming which condition applied — "not sorted" versus "not verified (file below 1 GiB)" — and deletes any stale `.idx` file. An invalid value also stops the program immediately. The `sequential-noindex` override always works, even on small or unsorted files.

## Environment Variables

All configuration is via environment variables (`.env` file). See [Configuration](#configuration) for the main options. The table below covers advanced tuning — you generally do not need to change these.

| Variable | Default | Valid Range | Description |
| --- | --- | --- | --- |
| `READ_MODE_FORCED` | *(none)* | `binary`, `index`, `sequential-noindex`, `sequential-index` | Hard override for the read mode. Bypasses `SINGLE_FILE_READ_MODE` entirely. |
| `CHUNK_COUNT` | auto | 1 -- 128 | Force a specific number of parallel file-reading chunks. Ignored when an HDD is detected. |
| `HIGH_WATER_MARK` | 16 | 1 -- 128 (MB) | Read buffer size per chunk, in megabytes. |
| `READ_AHEAD` | 2 | 1 -- 128 | Number of read-ahead buffers for streaming reads per chunk. |
| `HIBP_CONCURRENCY` | auto | 1 -- 1000 | Max concurrent HIBP API requests (only when `USE_HIBP_API=true`). |
| `SPLIT_FILE_CONCURRENCY` | auto | 1 -- 1024 | Max concurrent files when scanning a split-prefix directory. |
| `INDEX_READER_CONCURRENCY` | auto | 1 -- 1024 | Max concurrent random reads when using the `index` read mode. |
| `UV_THREADPOOL_SIZE` | CPU count | — | Automatically set to `os.availableParallelism()` if not already present. |
| `SPEED_TEST_MIN_BYTES` | 1073741824 (1 GB) | any integer (bytes) | File size threshold below which the drive speed test is skipped and a single chunk is used. |

**Auto-detection note:** The chunk count, HIBP concurrency, and split-file concurrency all auto-scale based on available CPU cores, free memory, and measured disk speed. You generally do not need to set them manually.

### Process Sandboxing (Node 24+)

Node 26 supports the `--permission` flag, which restricts what the process can access at runtime. This tool inherently needs file system access, network access (when using the HIBP API), and crypto — so sandboxing provides no security benefit here. However, if you embed parts of this tool as a library, you can use the permission model to restrict capabilities:

```bash
node --permission --allow-fs-read=/path/to/hashes.txt --allow-fs-write=/path/to/results.json dist/index.js
```

## Available Scripts

| Command | Description |
| --- | --- |
| `npm start` | Build the worker and run the tool |
| `npm run build` | Compile all TypeScript to JavaScript in `dist/` |
| `npm run build:worker` | Compile the worker thread script (used internally by other scripts) |
| `npm run start:compiled` | Run the pre-compiled version (faster startup, requires `build` first) |
| `npm run build:start:compiled` | Compile and run the pre-compiled version in one step |
| `npm run dry-run` | Build the worker and run a dry run (show summary without scanning) |
| `npm test` | Build the worker and run all tests (Vitest) |
| `npm run test:coverage` | Run tests with V8 coverage report (90% threshold) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint source code (ESLint) |
| `npm run lint-fix` | Lint and auto-fix |
| `npm run typecheck` | Type-check with `tsc --noEmit` |
| `npm run build-index` | Pre-build a `.idx` index file for a sorted hashes file (>= 1 GiB; refused below that or if unsorted) |
| `npm run generate-fixtures` | Regenerate test fixtures for encrypted export tests |

## How It Works

1. **Validate** the configuration (input paths, formats, output targets).
2. **Read** the input file (CSV or JSON, Bitwarden-compatible). If the JSON is a password-protected encrypted export, decrypt it first using the export password (see [Encrypted Exports](#encrypted-exports)).
3. **Hash** every password with the active hash type (SHA-1 by default, or the auto-detected/explicitly selected SHA-1 or NTLM).
4. **Scan** using the selected strategy:
   - `useHibpApi: true` -- queries the HIBP k-anonymity API with prefix grouping and a concurrency pool.
   - `useHibpApi: false` -- detects single file vs. split-prefix directory, runs a drive speed test (files >= 1 GB), determines chunk count, and scans in parallel via child-process workers.
5. **Sort** results by leak count (descending).
6. **Write** output to each configured target (CSV and/or JSON).

## Encrypted Exports

The tool supports **password-protected encrypted** Bitwarden JSON exports directly — no need to decrypt them beforehand.

### Supported encryption

| KDF Type | `kdfType` | Algorithm | Default Iterations | Status |
| --- | --- | --- | --- | --- |
| PBKDF2-SHA256 | `0` | PBKDF2 with HMAC-SHA256 | 600,000 | Supported (no extra dependencies) |
| Argon2id | `2` | Argon2id v1.3 | 3 passes, 64 MiB, 4 threads | Supported |

### Account-restricted vs. password-protected exports

Bitwarden offers two types of encrypted JSON exports:

| Type | `passwordProtected` | Decryptable locally? | How to export |
| --- | --- | --- | --- |
| **Account-restricted** | `false` or missing | **No** — encrypted with your Bitwarden account key | Default option in Bitwarden export |
| **Password-protected** | `true` | **Yes** — encrypted with a password you choose | Select "Password-protected" when exporting |

**This tool only supports password-protected exports.** If you see the error `account-restricted encrypted export`, re-export your vault:

1. In Bitwarden, go to **Tools > Export vault**
2. Select **"Password-protected"** (not the default)
3. Set a password when prompted
4. Use that password with `--export-password`, the `EXPORT_PASSWORD` env var, or the interactive prompt

### How to provide the export password

The password can be supplied in four ways (in order of precedence):

| Method | Example | Usability | Security |
| --- | --- | --- | --- |
| **CLI flag** | `npx tsx index.ts --export-password "MyP@ss"` | Quick for one-off runs. | ⚠️ **Insecure.** Password visible in `ps aux` process list. Remembered in shell history unless escaped with a leading space. Decryption fails immediately if wrong — no retry. |
| **Environment variable** | `EXPORT_PASSWORD=MyP@ss` in `.env` | Set once in `.env`, persists across runs. | ⚠️ **Insecure.** Plaintext in `.env` on disk. Do not commit `.env` to version control. |
| **Config file** | *(removed — use `.env` instead)* | — | — |
| **Interactive prompt** | *(typed at runtime, input masked)* | Must type each run; most manual. | **Most secure.** Never stored anywhere. Input is masked. |

1. **CLI flag** (highest priority):

   ```bash
   npx tsx index.ts --export-password "MyP@ss"
   ```

   If the password is wrong, decryption fails immediately with a specific error message — no retry. Verify your `--export-password` value.

2. **Environment variable** (via `.env`):

   ```bash
   EXPORT_PASSWORD=MyP@ss
   npm start
   ```

   If the password is wrong, decryption fails immediately with a specific error message — no retry. Verify your `EXPORT_PASSWORD` value.

3. **Interactive prompt** (fallback): If none of the above are set and the input is an encrypted export, you will be prompted to enter the password interactively (input is masked). Wrong passwords are retried automatically. Press **ESC** to cancel.

### CLI flags

| Flag | Description |
| --- | --- |
| `--export-password <value>` | Password for encrypted Bitwarden JSON exports. Takes precedence over `EXPORT_PASSWORD` in `.env`. |
| `--include-secrets` | Include plaintext passwords, TOTP secrets, password history, and FIDO2 credentials in output. Takes precedence over `INCLUDE_SECRETS` in `.env`. ⚠️ INSECURE — secrets written to disk. |
| `--dry-run` | Print a summary (password count, input format, hashes file, read mode) without scanning. |
| `--help`, `-h` | Print usage information and exit. |

### Example `.env` for encrypted export

```bash
INPUT_PATH=/path/to/bitwarden_encrypted_export.json
HASHES_OF_LEAKS_PATH=/path/to/pwned-passwords-sha1-ordered-by-hash.txt
USE_HIBP_API=false
HASH_TYPE=auto
HASH_TYPE_MISMATCH=error

OUTPUT_COUNT=1
OUTPUT_0_FORMAT=json
OUTPUT_0_PATH=/path/to/results.json
```

### Security notes

- Passing the password via CLI flag or environment variable is **insecure** — visible in process lists or stored as plaintext in `.env`. Prefer the interactive prompt.
- The export password and derived keys are held in memory only during decryption (~100-500ms) and are zeroed immediately after use.
- Plaintext passwords are materialized as owned buffers only while hashing and are zeroed immediately after; the SHA-1 (UTF-8) and NTLM (UTF-16LE) buffers and the MD4 working buffers are all cleared.
- Decrypted vault data is never written to disk — it exists in memory only long enough to extract passwords.
- A password validation step (encrypted UUID v4 check) confirms the password is correct before attempting vault decryption.
- Each incorrect password attempt takes 1-5 seconds due to the KDF, providing brute-force resistance.

## Output Security

By default (`INCLUDE_SECRETS=false`), the output files **exclude all inherent secrets** — only identification metadata and leak information are written. This is the recommended setting.

**Excluded by default:**

| Field | Why |
| --- | --- |
| `login_password` / `login.password` | Plaintext password |
| `login_totp` / `login.totp` | TOTP seed |
| `passwordHistory` | Old plaintext passwords |
| `login_fido2Credentials` / `fido2Credentials` | Passkey material |

**Always included:**

`name`, `folderName`, `typeLabel`, `login_username`, `login_uris`, `login_password_hash`, leak counts (`login_password_leaks`, `login_password_readable_leaks`, `login_password_compact_leaks`), `hasTotp`, `hasPasskey`, `uriCount`, `passwordAgeDays`, `notes`, `fields`, and all other identification metadata.

To include secrets, set `INCLUDE_SECRETS=true` in `.env` or use the `--include-secrets` CLI flag. This is marked as ⚠️ **INSECURE** — sensitive data will be written to disk as plaintext.

## Estimation Philosophy

The time estimates shown before scanning are intentionally biased for safety:

- **Sequential**: underestimated so the auto-detection defaults to it more often — it's the safe fallback that works on any disk, sorted or not.
- **Index**: slightly overestimated — fast random reads via a pre-built `.idx` file, but a small safety margin prevents surprise slowdowns.
- **Binary**: more overestimated — binary search is fast on SSDs but can be catastrophic on HDDs due to random seeks. The larger safety margin protects against choosing binary when sequential would be better, especially on spinning disks.
