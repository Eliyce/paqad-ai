import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, sep } from 'node:path';

import fg from 'fast-glob';

import { PATHS } from '@/core/constants/paths.js';

import type { RuleScriptMap } from './types.js';

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
    const stemDir = join(projectRoot, rel.replace(/\.mjs$/, ''));
    const fixturesDir = join(stemDir, '__fixtures__');
    if (existsSync(fixturesDir)) {
      rmSync(fixturesDir, { recursive: true, force: true });
      try {
        if (readdirSync(stemDir).length === 0) {
          rmSync(stemDir, { recursive: true, force: true });
        }
      } catch {}
    }
    deleted.push(rel.split(sep).join('/'));
  }
  return deleted;
}
