import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { MANAGED_HEADER } from './decision-pause-contract-writer.js';

/**
 * Issue #229 — the narration + decision-pause contracts moved out of every
 * project's `.paqad/` and into the framework install (carried by
 * `AGENT-BOOTSTRAP.md`). A project onboarded before #229 still has the two
 * managed copies on disk; left in place they are dead, confusing churn and (for
 * tracked repos) a stale committed file.
 *
 * This prunes them on `onboard` and `update`. It is deliberately conservative:
 * it only removes a file that begins with paqad's `MANAGED_HEADER`, so a path a
 * team happens to have repurposed is never touched. Absent/foreign files are a
 * no-op. Returns the project-relative paths actually removed (for reporting).
 */
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
      continue; // absent or unreadable — nothing to prune
    }
    if (!content.startsWith(MANAGED_HEADER)) {
      continue; // not paqad's managed doc — leave it alone
    }
    rmSync(path, { force: true });
    removed.push(relativePath);
  }
  return removed;
}
