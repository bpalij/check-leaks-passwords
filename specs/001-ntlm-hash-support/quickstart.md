# Quickstart: NTLM Hash Support

## Prerequisites
- Node.js >= 26
- Repository set up with dependencies installed (`npm i`)

## Test Data Setup

### Known NTLM vectors (for testing)
- `password` → `8846F7EAEE8FB117AD06BDD830B7586C`
- `00000000` → `9BDC61DB5A3FCED6D82D49279F1F0430`
- `123456` → `32ED87BDB5FDC5E9CBA88547376818D4`
- `letmein` → `BECEDB42EC3C5C7F965255338BE4453C`
- `password123` → `A9FDFA038C4B75EBC76DC855DD74F0DA`

Create test fixtures:
1. Create a small NTLM single-file corpus with known hashes
2. Create a small NTLM split-prefix directory
3. Create test vault with corresponding passwords

## Validation Scenarios

### Scenario 1: Explicit NTLM with single-file corpus
```bash
HASH_TYPE=ntlm
HASHES_OF_LEAKS_PATH=/path/to/ntlm-corpus.txt
INPUT_PATH=/path/to/vault.json
OUTPUT_COUNT=1
OUTPUT_0_FORMAT=json
OUTPUT_0_PATH=/tmp/results.json
```
Expected: Passwords hashed as NTLM, matched correctly. Output shows hash type.

### Scenario 2: Auto-detection (default) with NTLM corpus
Same as above but omit HASH_TYPE (or set to auto). Tool should detect NTLM from corpus format.

### Scenario 3: Backward compatibility - default with SHA-1 corpus
With SHA-1 corpus and no hash type specified, results identical to pre-feature behavior.

### Scenario 4: Mismatch mode error (default)
Set HASH_TYPE=ntlm but point to SHA-1 corpus → should abort with clear error message naming requested and detected types.

### Scenario 5: Mismatch mode warn
Set HASH_TYPE=ntlm, HASH_TYPE_MISMATCH=warn, point to SHA-1 corpus → should warn, self-correct to sha1, produce correct results.

### Scenario 6: NTLM API mode
```bash
HASH_TYPE=ntlm
USE_HIBP_API=true
INPUT_PATH=/path/to/vault.json
...
```
Only 5-char prefix transmitted; suffixes are 27 chars for NTLM.

### Scenario 7: Auto-detection with split-prefix dir
Point to NTLM split-prefix directory with HASH_TYPE=auto → should detect from suffix lengths (27 chars).

## Verification Checklist
- [x] NTLM hashes computed correctly (UTF-16LE MD4)
- [x] Output includes hash type in CSV/JSON
- [x] Console summary shows hash type and how chosen
- [x] Index files store and validate hash type
- [x] Legacy index files are invalidated
- [x] All existing tests still pass
- [x] New NTLM tests pass
