import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll } from 'vitest';

process.env.PAQAD_TEST_REAL_HOME ??= process.env.HOME ?? process.env.USERPROFILE ?? '';

const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'paqad-test-home-')));
process.env.HOME = home;
process.env.USERPROFILE = home;

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});
