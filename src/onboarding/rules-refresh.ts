import { rmSync } from 'node:fs';
import { join } from 'node:path';

import fg from 'fast-glob';

import { PATHS } from '@/core/constants/paths.js';
import { toPosixPath } from '@/core/path-utils.js';
import { getRuntimeRoot } from '@/core/runtime-paths.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import type { RoutingConfig } from '@/core/types/routing.js';
import { Resolver } from '@/resolver/resolver.js';

import { writeGeneratedFiles } from './file-writer.js';
import { generateProjectRules } from './rule-generator.js';

/**
 * Files under `docs/instructions/rules/` that are project-owned, not generated
 * from the framework rule packs. A `--rules` refresh must never delete these:
 * `module-map.yml` is authored by the documentation workflow and reviewed by
 * the team; `rule-script-map.yml` is produced by the rules-as-scripts flow.
 */
const PRESERVED_RULE_FILES = ['module-map.yml', 'rule-script-map.yml'];

export interface RulesRefreshReport {
  /** True when the refresh only reported the plan and made no changes (no `--force`). */
  dryRun: boolean;
  /** Generated rule files that were (or would be) deleted, project-relative, posix. */
  deleted: string[];
  /** Rule files that were (or would be) written, project-relative, posix. */
  written: string[];
  /** Project-owned files left untouched, project-relative, posix. */
  preserved: string[];
}

/**
 * Re-resolve the framework rule packs for the project's saved capabilities and
 * stack, then rewrite `docs/instructions/rules/`. The previously generated rule
 * tree is deleted first (so stale or removed rules do not linger), while
 * project-owned registries are preserved.
 *
 * Without `force`, returns the plan (what would be deleted/written) and makes no
 * changes. With `force`, applies the plan.
 */
export async function refreshProjectRules(
  projectRoot: string,
  profile: ProjectProfile,
  options: { force: boolean; runtimeRoot?: string },
): Promise<RulesRefreshReport> {
  const runtimeRoot = options.runtimeRoot ?? getRuntimeRoot();
  const routing: RoutingConfig = {
    active_capabilities: profile.active_capabilities,
    stack_profile: profile.stack_profile,
  };

  const resolved = await new Resolver({ runtimeRoot }).resolve(routing);
  const ruleFiles = await generateProjectRules(resolved.rules);

  const rulesDirAbs = join(projectRoot, PATHS.RULES_DIR);
  const existing = await fg('**/*', { cwd: rulesDirAbs, onlyFiles: true, dot: false });

  const preserved = existing.filter((rel) => PRESERVED_RULE_FILES.includes(rel));
  const deletable = existing.filter((rel) => !PRESERVED_RULE_FILES.includes(rel));

  const report: RulesRefreshReport = {
    dryRun: !options.force,
    deleted: deletable.map((rel) => toPosixPath(join(PATHS.RULES_DIR, rel))).sort(),
    written: ruleFiles.map((file) => toPosixPath(file.path)).sort(),
    preserved: preserved.map((rel) => toPosixPath(join(PATHS.RULES_DIR, rel))).sort(),
  };

  if (!options.force) {
    return report;
  }

  // Delete the previously generated rule tree first. generateProjectRules marks
  // every file `autoUpdate: false`, so writeGeneratedFiles skips paths that
  // still exist — clearing them is what lets the fresh content land.
  for (const rel of deletable) {
    rmSync(join(rulesDirAbs, rel), { force: true });
  }

  writeGeneratedFiles(projectRoot, ruleFiles);

  return report;
}
