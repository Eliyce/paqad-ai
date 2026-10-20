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

const PRESERVED_RULE_FILES = ['module-map.yml', 'rule-script-map.yml'];

export interface RulesRefreshReport {
  dryRun: boolean;
  deleted: string[];
  written: string[];
  preserved: string[];
}

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

  for (const rel of deletable) {
    rmSync(join(rulesDirAbs, rel), { force: true });
  }

  writeGeneratedFiles(projectRoot, ruleFiles);

  return report;
}
