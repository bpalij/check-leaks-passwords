# check-leaks-passwords

Check if passwords in csv or json file (compatible with bitwarden export) exist in txt file of hashes of leaked password (compatible with haveibeenpwned.com sha1 file) and output info to csv or json file
Unified version of check-leaks-csv-passwords and check-leaks-json-passwords with swappable input/output formats

Requires Node 18+

## How to use

1. Export csv or json from your password manager (compatible with bitwarden)
2. Download SHA1 list from <https://haveibeenpwned.com/Passwords> with any sort and extract txt file with info about password leaks
3. Clone this git repository, in cloned repository:
4. Copy `config/config.example.ts` as `config/config.ts` and change values to yours
5. `npm i`
6. `npm start`

## Available scripts

- `npm start` — Run the tool (via ts-node)
- `npm test` — Run tests (Vitest)
- `npm run test:coverage` — Run tests with coverage report (80% threshold)
- `npm run test:watch` — Run tests in watch mode
- `npm run lint` — Lint source code
- `npm run typecheck` — Type-check with `tsc --noEmit`
