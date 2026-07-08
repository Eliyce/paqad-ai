// Deterministic rule-script-map generation (issue #319).
//
// The rule-scripts engine (enforce/runner/integrity/apply) was live but DISARMED
// on every fresh project, because `rule-script-map.yml` — the map linking each
// rule to its compiled scripts — was produced by no code path. Onboarding
// refreshed the rule tree but preserved (never generated) the map, so the
// enforcement seam fast-skipped on a missing map and the gate passed by default.
//
// This module is the generator. It reuses the analyzer's deterministic mechanics
// (`scanAndEmbedIds` to embed stable rule ids, `assembleMap` to build the map) and
// the atomic writer (`applyRuleScriptMap`) — it authors no scripts and makes no
// judgement calls (that is the rule-analyzer skill's job). Its role is to make the
// map EXIST and stay in sync with the rule tree, so the gate is armed: enforcement
// runs, and any scripts the skill later binds are honoured. Scripts already bound
// in a prior map carry over for rules whose text is unchanged.

import {
  assembleMap,
  collectRuleFiles,
  computeRuleFilesHash,
  scanAndEmbedIds,
} from './analyzer.js';
import { applyRuleScriptMap } from './apply.js';
import { loadRuleScriptMap } from './map.js';
import type { RuleScriptMap } from './types.js';

/**
 * Whether `rule-script-map.yml` is missing or out of sync with the rule tree
 * (issue #319). True when there is no map, or the map's `rule_files_hash` no longer
 * matches the current rule files — the only conditions under which onboarding needs
 * to (re)compile. Guarding on this keeps a re-onboard over an UNCHANGED rule tree a
 * pure no-op: no fresh `generated_at` timestamp, no history snapshot, no events-log
 * append — so onboarding stays byte-idempotent (the e2e idempotency contract).
 */
export function isRuleScriptMapStale(projectRoot: string): boolean {
  const map = loadRuleScriptMap(projectRoot);
  if (!map) return true;
  return map.rule_files_hash !== computeRuleFilesHash(projectRoot, collectRuleFiles(projectRoot));
}

export interface CompileRuleScriptsResult {
  map: RuleScriptMap;
  /** Total rules listed in the map. */
  ruleCount: number;
  /** Rules that carry at least one compiled script (blocking-capable). */
  scriptedCount: number;
  /** Rule files rewritten because a stable id was embedded (idempotent after the first run). */
  changedFiles: string[];
  snapshotPath: string;
  appliedAt: string;
}

/**
 * Compile (generate or refresh) `rule-script-map.yml` from the project's rule
 * tree and write it atomically. Deterministic — no LLM: every rule is listed with
 * its stable id; verifiability + scripts carry over from the prior map when a
 * rule's text is unchanged, and a brand-new rule lands `heuristic` with no scripts
 * until the analyzer skill classifies it. Idempotent: a second run over an
 * unchanged tree embeds no new ids and produces the same map.
 */
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
