import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { RegressionGuard } from '@/core/types/fix-protocol.js';
import { DEFECT_ID_PATTERN } from '@/core/types/fix-protocol.js';

function assertSafeDefectId(defectId: string): void {
  if (!DEFECT_ID_PATTERN.test(defectId)) {
    throw new Error(
      `Invalid defect_id "${defectId}": must be a filename-safe slug (letters, digits, ., _, -).`,
    );
  }
}

function guardDir(projectRoot: string): string {
  return join(projectRoot, PATHS.REGRESSION_GUARDS_DIR);
}

function guardPath(projectRoot: string, defectId: string): string {
  return join(guardDir(projectRoot), `${defectId}.json`);
}

/**
 * Persists a regression guard sidecar to `.paqad/regression-guards/<defect_id>.json`.
 * This is the "keep the proof" artifact (issue #103): the committed proof test
 * stays in the suite, and this registry links its `defect_id` to that test plus
 * the captured failing evidence, so the same defect cannot silently return.
 * The write is atomic (temp file + rename).
 */
export async function writeRegressionGuard(
  projectRoot: string,
  guard: RegressionGuard,
): Promise<string> {
  assertSafeDefectId(guard.defect_id);
  const targetPath = guardPath(projectRoot, guard.defect_id);
  await mkdir(guardDir(projectRoot), { recursive: true });

  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  const payload = `${JSON.stringify(guard, null, 2)}\n`;
  await writeFile(tempPath, payload, 'utf8');
  await rename(tempPath, targetPath);

  return targetPath;
}

/** Reads a single regression guard, or null if it does not exist / is unreadable. */
export async function readRegressionGuard(
  projectRoot: string,
  defectId: string,
): Promise<RegressionGuard | null> {
  assertSafeDefectId(defectId);
  let raw: string;
  try {
    raw = await readFile(guardPath(projectRoot, defectId), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  return JSON.parse(raw) as RegressionGuard;
}

/** Lists every persisted regression guard, sorted by `defect_id`. */
export async function listRegressionGuards(projectRoot: string): Promise<RegressionGuard[]> {
  let entries: string[];
  try {
    entries = await readdir(guardDir(projectRoot));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    /* v8 ignore next 2 -- non-ENOENT readdir failures are not exercised in unit tests */
    throw error;
  }

  const guards: RegressionGuard[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.json')) {
      continue;
    }
    const raw = await readFile(join(guardDir(projectRoot), entry), 'utf8');
    guards.push(JSON.parse(raw) as RegressionGuard);
  }
  return guards;
}
