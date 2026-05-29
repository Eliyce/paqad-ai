// Pure, per-rule mutations of the rule-script map (issue #89).
//
// These never touch disk — they return a new map that the caller writes through
// src/rule-scripts/apply.ts (the single writer). Per-rule selective edits keep
// the no-global-rebuild guarantee.

import type { RuleScriptMap, ScriptEntry, Verifiability } from './types.js';

function cloneMap(map: RuleScriptMap): RuleScriptMap {
  return JSON.parse(JSON.stringify(map)) as RuleScriptMap;
}

function findRule(map: RuleScriptMap, ruleId: string) {
  return map.rules.find((r) => r.id === ruleId);
}

// Insert or replace a script entry on a rule (keyed by script path).
export function upsertScriptEntry(
  map: RuleScriptMap,
  ruleId: string,
  entry: ScriptEntry,
): RuleScriptMap {
  const next = cloneMap(map);
  const rule = findRule(next, ruleId);
  if (!rule) {
    throw new Error(`upsertScriptEntry: rule ${ruleId} not found in map`);
  }
  const idx = rule.scripts.findIndex((s) => s.path === entry.path);
  if (idx >= 0) {
    rule.scripts[idx] = entry;
  } else {
    rule.scripts.push(entry);
  }
  rule.scripts.sort((a, b) => a.path.localeCompare(b.path));
  return next;
}

// Insert a new rule as a stub entry (unclassified heuristic, no scripts) so the
// map stays in sync the moment `add rule` writes the markdown — otherwise the
// reconciler emits a false RS-RULE-ADDED until the user re-runs `analyze rules`
// (D-1). The rule-analyzer reclassifies it on the next pass.
export function addRuleEntry(
  map: RuleScriptMap,
  entry: { id: string; source: string; text: string; text_hash: string },
): RuleScriptMap {
  const next = cloneMap(map);
  if (next.rules.some((r) => r.id === entry.id)) {
    throw new Error(`addRuleEntry: rule ${entry.id} already in map`);
  }
  next.rules.push({
    id: entry.id,
    source: entry.source,
    text: entry.text,
    text_hash: entry.text_hash,
    verifiability: { kind: 'heuristic' },
    enforced_by: [],
    scripts: [],
  });
  return next;
}

// Update a rule's text + hash after an in-place markdown edit, keeping the map
// in sync atomically (mirrors the `remove` cascade). The prior scripts no
// longer match the new text, so they are cleared — the editor then regenerates
// only this rule's scripts. Without this, the reconciler emits a false
// RS-RULE-EDITED until the user manually re-runs `analyze rules`.
export function setRuleText(
  map: RuleScriptMap,
  ruleId: string,
  text: string,
  textHash: string,
): RuleScriptMap {
  const next = cloneMap(map);
  const rule = findRule(next, ruleId);
  if (!rule) {
    throw new Error(`setRuleText: rule ${ruleId} not found in map`);
  }
  rule.text = text;
  rule.text_hash = textHash;
  rule.scripts = [];
  return next;
}

// Drop all scripts from a rule (e.g. downgrade to unverifiable, or pre-regen).
export function clearRuleScripts(map: RuleScriptMap, ruleId: string): RuleScriptMap {
  const next = cloneMap(map);
  const rule = findRule(next, ruleId);
  if (rule) {
    rule.scripts = [];
  }
  return next;
}

// Change a rule's verifiability (e.g. `mark rule as unverifiable`). When the
// new kind is unverifiable, its scripts are cleared.
export function setVerifiability(
  map: RuleScriptMap,
  ruleId: string,
  verifiability: Verifiability,
): RuleScriptMap {
  const next = cloneMap(map);
  const rule = findRule(next, ruleId);
  if (!rule) {
    throw new Error(`setVerifiability: rule ${ruleId} not found in map`);
  }
  rule.verifiability = verifiability;
  if (verifiability.kind === 'unverifiable') {
    rule.scripts = [];
  }
  return next;
}

// Move a rule into the archived: section (delayed delete). Its scripts stay on
// disk until the next regen cycle prunes them.
export function archiveRule(map: RuleScriptMap, ruleId: string): RuleScriptMap {
  const next = cloneMap(map);
  const idx = next.rules.findIndex((r) => r.id === ruleId);
  if (idx < 0) {
    return next;
  }
  const [removed] = next.rules.splice(idx, 1);
  next.archived = [...(next.archived ?? []), removed];
  return next;
}
