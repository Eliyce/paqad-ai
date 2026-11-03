import { readCapabilityDigest } from '@/kernel/capability-lock.js';

import {
  assembleMap,
  collectRuleFiles,
  computeRuleFilesHash,
  scanAndEmbedIds,
} from './analyzer.js';
import { applyRuleScriptMap } from './apply.js';
import { computeRuleScriptsDigest } from './integrity.js';
import { loadRuleScriptMap } from './map.js';
import type { RuleScriptMap } from './types.js';

export function isRuleScriptMapStale(projectRoot: string): boolean {
  const map = loadRuleScriptMap(projectRoot);
  if (!map) return true;
  return map.rule_files_hash !== computeRuleFilesHash(projectRoot, collectRuleFiles(projectRoot));
}

export function isRuleScriptMapCurrent(projectRoot: string): boolean {
  try {
    return !isRuleScriptMapStale(projectRoot);
  } catch {
    return false;
  }
}

export function dropRuleScriptMapSources(
  projectRoot: string,
  sources: readonly string[],
  mapWasCurrent: boolean,
): void {
  const map = loadRuleScriptMap(projectRoot);
  if (!map) return;
  const dropped = map.rules.filter((rule) => sources.includes(rule.source));
  if (dropped.length === 0 && !mapWasCurrent) return;
  const digestWasValid =
    readCapabilityDigest(projectRoot, 'rule-scripts') === computeRuleScriptsDigest(projectRoot);
  applyRuleScriptMap({
    projectRoot,
    map: {
      ...map,
      rule_files_hash: mapWasCurrent
        ? computeRuleFilesHash(projectRoot, collectRuleFiles(projectRoot))
        : map.rule_files_hash,
      rules: map.rules.filter((rule) => !sources.includes(rule.source)),
    },
    via: 'update-cleanup',
    event: {
      action: 'remove',
      rule_ids: dropped.map((rule) => rule.id),
      note: sources.join(', '),
    },
    keepDigest: !digestWasValid,
  });
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
