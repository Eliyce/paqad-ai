import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import type { RegressionGuard } from '@/core/types/fix-protocol.js';
import { REGRESSION_GUARD_SCHEMA_VERSION } from '@/core/types/fix-protocol.js';
import {
  listRegressionGuards,
  readRegressionGuard,
  writeRegressionGuard,
} from '@/fix-protocol/regression-guard.js';

function guard(defectId: string): RegressionGuard {
  return {
    schema_version: REGRESSION_GUARD_SCHEMA_VERSION,
    defect_id: defectId,
    created_at: '2026-06-07T00:00:00.000Z',
    proof: {
      test_id: 'x > proof',
      test_file: 'tests/unit/x.test.ts',
      command: 'pnpm vitest run tests/unit/x.test.ts',
    },
    failing_evidence: {
      category: 'test-failure',
      file: 'src/x.ts',
      line: 10,
      test_id: 'x > proof',
      suite: 'x',
      ac_id: null,
      message: 'expected true',
      stderr_excerpt: null,
    },
    linked_ac_id: null,
  };
}

describe('regression-guard registry', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-guards-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('writes and reads a guard round-trip', async () => {
    const path = await writeRegressionGuard(projectRoot, guard('DEF-1'));
    expect(path).toBe(join(projectRoot, PATHS.REGRESSION_GUARDS_DIR, 'DEF-1.json'));

    const read = await readRegressionGuard(projectRoot, 'DEF-1');
    expect(read).toEqual(guard('DEF-1'));
  });

  it('returns null for a missing guard', async () => {
    expect(await readRegressionGuard(projectRoot, 'NOPE')).toBeNull();
  });

  it('lists guards sorted by defect_id and ignores non-json entries', async () => {
    await writeRegressionGuard(projectRoot, guard('DEF-2'));
    await writeRegressionGuard(projectRoot, guard('DEF-1'));
    writeFileSync(join(projectRoot, PATHS.REGRESSION_GUARDS_DIR, 'notes.txt'), 'ignore me');

    const guards = await listRegressionGuards(projectRoot);
    expect(guards.map((g) => g.defect_id)).toEqual(['DEF-1', 'DEF-2']);
  });

  it('returns an empty list when the registry does not exist', async () => {
    expect(await listRegressionGuards(projectRoot)).toEqual([]);
  });

  it('rejects an unsafe defect_id on write', async () => {
    await expect(writeRegressionGuard(projectRoot, guard('../escape'))).rejects.toThrow(
      /filename-safe/,
    );
  });

  it('rejects an unsafe defect_id on read', async () => {
    await expect(readRegressionGuard(projectRoot, 'a/b')).rejects.toThrow(/filename-safe/);
  });

  it('propagates a non-ENOENT read error', async () => {
    // A directory at the guard path makes readFile throw EISDIR (not ENOENT).
    mkdirSync(join(projectRoot, PATHS.REGRESSION_GUARDS_DIR, 'DEF-9.json'), { recursive: true });
    await expect(readRegressionGuard(projectRoot, 'DEF-9')).rejects.toThrow();
  });
});
