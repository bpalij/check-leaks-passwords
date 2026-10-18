import { afterAll } from 'vitest';

import { cleanupTestTmp } from '../helpers/testTmp.js';

// Per-file safety net: runs even when individual tests time out and their own
// cleanup hooks are skipped, preventing `tests/__output__/_tmp` accumulation.
afterAll(() => {
  cleanupTestTmp();
});
