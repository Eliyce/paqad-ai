// Prune orphaned rule-script files (issue #89, archive-retention AC).
//
// Editing a rule (text_hash change) or downgrading it to unverifiable clears
// its scripts from the map, and `remove` archives the rule — but the .mjs files
// + __fixtures__/ stay on disk. This deletes any .mjs under .paqad/scripts/rules
// not referenced by an ACTIVE map rule. Archived rules' scripts are intentionally
// not referenced, so they survive until the next regen cycle then get pruned —
// the "one cycle" grace period.

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import fg from 'fast-glob';

import { PATHS } from '@/core/constants/paths.js';

import type { RuleScriptMap } from './types.js';

// Returns the project-relative paths of the .mjs scripts (and their fixture
// dirs) that were deleted.
export function pruneOrphanScripts(projectRoot: string, map: RuleScriptMap): string[] {
  const baseRel = PATHS.RULE_SCRIPTS_DIR;
  const baseAbs = join(projectRoot, baseRel);
  if (!existsSync(baseAbs)) {
    return [];
  }

  const referenced = new Set(map.rules.flatMap((r) => r.scripts.map((s) => s.path)));
  const found = fg.sync('**/*.mjs', {
    cwd: baseAbs,
    onlyFiles: true,
    ignore: ['.cache/**', '.history/**'],
  });

  const deleted: string[] = [];
  for (const sub of found) {
    const rel = join(baseRel, sub);
    if (referenced.has(rel)) {
      continue;
    }
    rmSync(join(projectRoot, rel), { force: true });
    // The sibling fixtures directory is named after the script (sans .mjs).
    const fixturesDir = join(projectRoot, rel.replace(/\.mjs$/, ''));
    if (existsSync(fixturesDir)) {
      rmSync(fixturesDir, { recursive: true, force: true });
    }
    deleted.push(rel);
  }
  return deleted;
}
