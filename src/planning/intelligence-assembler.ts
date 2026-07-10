import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import fg from 'fast-glob';

import { PATHS } from '@/core/constants/paths.js';
import type { IntelligenceContext, ManifestClassification } from '@/core/types/planning.js';

import { buildCoverageOverlay } from './coverage-overlay.js';
import { queryMatchingDefectPatterns } from './defect-advisory.js';
import { predictTokenCeiling } from './cost-predictor.js';
import { readAllModuleHealth } from './module-health.js';
import { syncModuleHealth } from './module-health-updater.js';
import { readCompiledRules } from './rule-compiler.js';

export async function assembleIntelligence(
  root: string,
  classification: ManifestClassification,
): Promise<IntelligenceContext> {
  await syncModuleHealth({
    projectRoot: root,
    source: 'preflight',
    preflight: true,
    silent: true,
  });

  const [groupA, groupB, predictedTokens] = await Promise.all([
    Promise.all([
      readAllModuleHealth(root),
      readCompiledRules(root),
      readInheritedConstraints(root, classification.affected_modules),
    ]),
    Promise.all([
      buildCoverageOverlay(root, classification.affected_modules),
      queryMatchingDefectPatterns({
        stack: classification.stack,
        affectedModules: classification.affected_modules,
      }),
      loadSelectiveDocs(root, classification.affected_modules),
      findExistingImplementations(root, classification.affected_modules),
    ]),
    predictTokenCeiling(root, {
      lane: classification.lane,
      complexity: classification.complexity,
      scope: classification.scope,
    }),
  ]);

  const [moduleHealth, compiledRules, inheritedConstraints] = groupA;
  const [coverageOverlay, defectPatterns, selectiveDocs, existingImplementations] = groupB;

  return {
    module_health: moduleHealth,
    compiled_rules: compiledRules,
    inherited_constraints: inheritedConstraints,
    coverage_overlay: coverageOverlay,
    defect_patterns: defectPatterns.map((pattern) => ({
      pattern_id: pattern.pattern_id,
      subcategory: pattern.subcategory,
      description: pattern.description,
      frequency: pattern.frequency,
    })),
    selective_docs: selectiveDocs,
    existing_implementations: existingImplementations,
    predicted_tokens: predictedTokens,
  };
}

async function readInheritedConstraints(root: string, modules: string[]): Promise<string[]> {
  const files = await fg(`${PATHS.PLANNING_MANIFESTS_DIR}/*.yaml`, { cwd: root, onlyFiles: true });
  return files.filter((file) => modules.some((moduleName) => file.includes(moduleName)));
}

async function loadSelectiveDocs(
  root: string,
  modules: string[],
): Promise<Array<{ path: string; content: string }>> {
  const modulePatterns =
    modules.length > 0
      ? modules.map((moduleName) => `docs/modules/${moduleName}/**/*.md`)
      : ['docs/instructions/**/*.md'];
  const files = await fg(modulePatterns, { cwd: root, onlyFiles: true });
  const selected = files.slice(0, 5);
  return Promise.all(
    selected.map(async (file) => ({
      path: file,
      content: await readFile(join(root, file), 'utf8'),
    })),
  );
}

async function findExistingImplementations(
  root: string,
  modules: string[],
): Promise<IntelligenceContext['existing_implementations']> {
  const patterns =
    modules.length > 0 ? modules.map((moduleName) => `src/${moduleName}/**/*.ts`) : ['src/**/*.ts'];
  const files = await fg(patterns, { cwd: root, onlyFiles: true });
  return files.slice(0, 5).map((file, index) => ({
    file_path: file,
    /* c8 ignore next */
    function_name: file.split('/').pop()?.replace(/\.ts$/, '') ?? `impl-${index + 1}`,
    description: `Existing implementation candidate in ${file}`,
    relevance_score: Number((1 - index * 0.1).toFixed(2)),
  }));
}
