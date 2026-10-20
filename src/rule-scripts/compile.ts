import {
  assembleMap,
  collectRuleFiles,
  computeRuleFilesHash,
  scanAndEmbedIds,
} from './analyzer.js';
import { applyRuleScriptMap } from './apply.js';
import { loadRuleScriptMap } from './map.js';
import type { RuleScriptMap } from './types.js';

export function isRuleScriptMapStale(projectRoot: string): boolean {
  const map = loadRuleScriptMap(projectRoot);
  if (!map) return true;
  return map.rule_files_hash !== computeRuleFilesHash(projectRoot, collectRuleFiles(projectRoot));
}

export interface CompileRuleScriptsResult {
  map: RuleScriptMap;
  ruleCount: number;
  scriptedCount: number;
  changedFiles: string[];
  snapshotPath: string;
  appliedAt: string;
}

export function compileRuleScripts(projectRoot: string): CompileRuleScriptsResult {
  const scan = scanAndEmbedIds(projectRoot);
  const prior = loadRuleScriptMap(projectRoot);
  const map = assembleMap(scan.inventory, new Map(), scan.rule_files_hash, prior);
  const applied = applyRuleScriptMap({
    projectRoot,
    map,
    via: 'rules-compile',
    event: { action: 'generate', rule_ids: map.rules.map((rule) => rule.id) },
  });
  return {
    map,
    ruleCount: map.rules.length,
    scriptedCount: map.rules.filter((rule) => rule.scripts.length > 0).length,
    changedFiles: scan.changed_files,
    snapshotPath: applied.snapshot_path,
    appliedAt: applied.applied_at,
  };
}
