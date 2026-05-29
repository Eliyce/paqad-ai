// Prune orphaned rule-script files (issue #89, archive-retention AC).
//
// Editing a rule (text_hash change) or downgrading it to unverifiable clears
// its scripts from the map, and `remove` archives the rule — but the .mjs files
// + __fixtures__/ stay on disk. This deletes any .mjs under .paqad/scripts/rules
// not referenced by an ACTIVE map rule. Archived rules' scripts are intentionally
// not referenced, so they survive until the next regen cycle then get pruned —
// the "one cycle" grace period.

import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, sep } from 'node:path';

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
  // cwd is already .paqad/scripts/rules, so these ignores match its own
  // .cache/ and .history/ subtrees.
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
    // The script's fixtures live at <script-stem>/__fixtures__/. Remove only the
    // __fixtures__ subtree (never the whole stem dir, which may hold sibling
    // scripts or auxiliary files), then drop the stem dir only if it's now
    // empty (D-2/D-7).
    const stemDir = join(projectRoot, rel.replace(/\.mjs$/, ''));
    const fixturesDir = join(stemDir, '__fixtures__');
    if (existsSync(fixturesDir)) {
      rmSync(fixturesDir, { recursive: true, force: true });
      try {
        if (readdirSync(stemDir).length === 0) {
          rmSync(stemDir, { recursive: true, force: true });
        }
      } catch {
        // stem dir gone or unreadable — nothing to clean up.
      }
    }
    // Normalise separators so reported paths are stable across platforms.
    deleted.push(rel.split(sep).join('/'));
  }
  return deleted;
}
