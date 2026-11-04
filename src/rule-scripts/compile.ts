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
import { setRuleText } from './mutate.js';
import { ruleTextHash } from './rule-id.js';
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

export interface RepairedRuleText {
  id: string;
  text: string;
}

export function dropRuleScriptMapSources(
  projectRoot: string,
  sources: readonly string[],
  mapWasCurrent: boolean,
  repairedTexts: readonly RepairedRuleText[] = [],
): void {
  const map = loadRuleScriptMap(projectRoot);
  if (!map) return;
  const dropped = map.rules.filter((rule) => sources.includes(rule.source));
  const edits = repairedTexts.filter((edit) => map.rules.some((rule) => rule.id === edit.id));
  const ruleFilesHash = mapWasCurrent
    ? computeRuleFilesHash(projectRoot, collectRuleFiles(projectRoot))
    : map.rule_files_hash;
  if (dropped.length === 0 && edits.length === 0 && ruleFilesHash === map.rule_files_hash) return;
  const digestWasValid =
    readCapabilityDigest(projectRoot, 'rule-scripts') === computeRuleScriptsDigest(projectRoot);
  const edited = edits.reduce(
    (current, edit) => setRuleText(current, edit.id, edit.text, ruleTextHash(edit.text)),
    map,
  );
  applyRuleScriptMap({
    projectRoot,
    map: {
      ...edited,
      rule_files_hash: ruleFilesHash,
      rules: edited.rules.filter((rule) => !sources.includes(rule.source)),
    },
    via: 'update-cleanup',
    event:
      dropped.length > 0
        ? {
            action: 'remove',
            rule_ids: dropped.map((rule) => rule.id),
            note: sources.join(', '),
          }
        : {
            action: edits.length > 0 ? 'edit' : 'reconcile',
            rule_ids: edits.map((edit) => edit.id),
            note: 'refreshed the rule file hash after update',
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
