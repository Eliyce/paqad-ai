import { readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import fg from 'fast-glob';

import type { ExecutionSlice, RegressionEntry } from '@/core/types/planning.js';

export async function buildRegressionWatchList(
  root: string,
  executionSlices: ExecutionSlice[],
): Promise<RegressionEntry[]> {
  const testFiles = await fg('tests/**/*.ts', { cwd: root, onlyFiles: true });
  const entries: RegressionEntry[] = [];
  let index = 1;

  for (const slice of executionSlices) {
    for (const touchedFile of slice.touches) {
      const stem = basename(touchedFile, extname(touchedFile));
      for (const testFile of testFiles) {
        const raw = await readFile(join(root, testFile), 'utf8').catch(() => '');
        if (!raw.includes(stem) && !raw.includes(touchedFile)) {
          continue;
        }

        const testName = raw.match(/(?:it|test)\((['"`])(.+?)\1/)?.[2];
        entries.push({
          entry_id: `REG-${index++}`,
          test_file: testFile,
          test_name: testName,
          touched_file: touchedFile,
          slice_id: slice.slice_id,
          status: 'pending',
        });
      }
    }
  }

  return entries;
}
