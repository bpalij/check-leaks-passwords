import './src/memory/secureCleanup.js';
import { checkPasswordsLeaks } from './src/checkPasswordsLeaks.js';
import { loadConfig } from './src/envLoader.js';

try { process.loadEnvFile(); } catch { /* .env is optional */ }

const [major] = process.versions.node.split('.').map(Number);
if (major < 26) {
  process.stderr.write(
    `Error: Node.js >= 26 is required (found ${process.version})\n`,
  );
  process.exit(1);
}

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(`Usage: check-leaks [options]

Options:
  --export-password <pw>  Password for encrypted Bitwarden exports
  --dry-run              Show summary without scanning
  --include-secrets      Include plaintext passwords/TOTP in output
  --help, -h             Show this help

Configuration via environment variables (.env or shell):
  INPUT_PATH              (required) Path to Bitwarden export (CSV or JSON)
  HASHES_OF_LEAKS_PATH    Path to HIBP hashes file or split-prefix directory
  USE_HIBP_API            true/false — query HIBP API instead of local file
  OUTPUT_COUNT            Number of outputs (with OUTPUT_{i}_FORMAT, OUTPUT_{i}_PATH)
  EXPORT_PASSWORD         Alternative to --export-password
  INCLUDE_SECRETS         Alternative to --include-secrets
  SINGLE_FILE_READ_MODE   auto | sequential | binary | index
  BUILD_INDEX             true/false — build .idx file for faster repeat scans
  READ_AHEAD              Number of read-ahead streams (default: 2)
  HIBP_CONCURRENCY        Parallel API requests (default: 200, max: 200)
  MAX_OPEN_FILES          Max concurrent file descriptors for split-dir reads
`);
  process.exit(0);
}

const dryRun = args.includes('--dry-run');
const includeSecretsFlag = args.includes('--include-secrets');

const exportPasswordIdx = args.indexOf('--export-password');
if (exportPasswordIdx !== -1) {
  if (exportPasswordIdx + 1 >= args.length) {
    process.stderr.write('Error: --export-password requires a value\n');
    process.exit(1);
  }
}

const cliPassword = exportPasswordIdx !== -1 ? args[exportPasswordIdx + 1] : undefined;

/**
 * CLI entry point for check-leaks-passwords.
 *
 * Parses command-line arguments, loads configuration from environment
 * variables, and runs the main pipeline to check Bitwarden passwords
 * against HIBP data. Exits with code 0 on success, 1 on failure.
 */
const config = loadConfig();
if (cliPassword) {
  config.exportPassword = cliPassword;
}
if (includeSecretsFlag) {
  config.includeSecrets = true;
}
checkPasswordsLeaks(config, { dryRun }).then(() => {
  process.exit(0);
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
