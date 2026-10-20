import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { MANAGED_HEADER } from './decision-pause-contract-writer.js';

const OBSOLETE_MANAGED_DOCS: readonly string[] = [
  PATHS.DECISION_PAUSE_CONTRACT,
  PATHS.NARRATION_CONTRACT,
];

export function removeObsoleteContractDocs(projectRoot: string): string[] {
  const removed: string[] = [];
  for (const relativePath of OBSOLETE_MANAGED_DOCS) {
    const path = join(projectRoot, relativePath);
    let content: string;
    try {
      content = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    if (!content.startsWith(MANAGED_HEADER)) {
      continue;
    }
    rmSync(path, { force: true });
    removed.push(relativePath);
  }
  return removed;
}
