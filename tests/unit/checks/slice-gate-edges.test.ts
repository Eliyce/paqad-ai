import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  acTagFailures,
  heavyRunFailures,
  runSliceGate,
  sliceDigest,
  wiredFailures,
} from '@/checks/slice-gate.js';

import { makeEmptyRepo, writeRepoFile } from '../pipeline/changed-files.fixture.js';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function root(): string {
  const dir = makeEmptyRepo('main');
  roots.push(dir);
  return dir;
}

const SEAM = { name: 'rows', entry_file: 'src/store/rows.ts', wired_ac: 'AC-2' };

describe('slice gate checks on missing and unnamed files', () => {
  it('AC-12 skips an owned test file that is gone', () => {
    const dir = root();
    expect(heavyRunFailures(dir, ['tests/gone.test.ts'])).toEqual([]);
  });

  it('AC-2 fails a criterion no owned test names, ignoring files that are gone', () => {
    const dir = root();
    writeRepoFile(dir, 'tests/a.test.ts', "it('AC-1 reads', () => {});\n");
    expect(acTagFailures(dir, ['AC-1', 'AC-9'], ['tests/a.test.ts', 'tests/gone.test.ts'])).toEqual(
      ['ac tag: no owned test names AC-9'],
    );
  });

  it('AC-11 passes a seam no owned test names and fails one wired only through a package name', () => {
    const dir = root();
    expect(wiredFailures(dir, [SEAM], ['tests/gone.test.ts'])).toEqual([]);
    writeRepoFile(
      dir,
      'tests/api.test.ts',
      "import { rows } from 'store-package';\nit('AC-2 wires rows', () => rows);\n",
    );
    expect(wiredFailures(dir, [SEAM], ['tests/api.test.ts'])).toEqual([
      'wired: AC-2 does not import src/store/rows.ts without a mock',
    ]);
  });

  it('AC-11 resolves a relative import of the seam entry and fails it once mocked', () => {
    const dir = root();
    const body = "import { rows } from '../../src/store/rows.js';\nit('AC-2 wires', () => rows);\n";
    writeRepoFile(dir, 'tests/api/get.test.ts', body);
    expect(wiredFailures(dir, [SEAM], ['tests/api/get.test.ts'])).toEqual([]);
    writeRepoFile(dir, 'tests/api/get.test.ts', `${body}vi.mock('../../src/store/rows.js');\n`);
    expect(wiredFailures(dir, [SEAM], ['tests/api/get.test.ts'])).toHaveLength(1);
  });
});

describe('slice digest without git', () => {
  it('AC-13 falls back to hashing file text when git cannot run and still removes its index', () => {
    const dir = root();
    writeRepoFile(dir, 'src/a.ts', 'one\n');
    const files = ['src/a.ts', 'src/gone.ts'];
    const first = sliceDigest(dir, 'store', files, 'paqad-no-such-git');
    expect(sliceDigest(dir, 'store', files, 'paqad-no-such-git')).toBe(first);
    writeRepoFile(dir, 'src/a.ts', 'two\n');
    expect(sliceDigest(dir, 'store', files, 'paqad-no-such-git')).not.toBe(first);
    const tmp = join(dir, '.paqad', 'tmp');
    expect(existsSync(tmp) ? readdirSync(tmp) : []).toEqual([]);
  });

  it('AC-34 names the slowest step on every run, with the default clock and steps', async () => {
    const dir = root();
    const result = await runSliceGate({
      projectRoot: dir,
      subject: { id: 'store', owned_files: ['src/**'], acs: [], seams: [] },
      changedFiles: [],
    });
    expect(result).toMatchObject({ passed: true, timed_out: false, files: [] });
    expect(typeof result.slowest_step).toBe('string');
  });
});
