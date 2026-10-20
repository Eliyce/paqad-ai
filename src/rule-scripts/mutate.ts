import type { RuleScriptMap, ScriptEntry, Verifiability } from './types.js';

function cloneMap(map: RuleScriptMap): RuleScriptMap {
  return JSON.parse(JSON.stringify(map)) as RuleScriptMap;
}

function findRule(map: RuleScriptMap, ruleId: string) {
  return map.rules.find((r) => r.id === ruleId);
}

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

export function clearRuleScripts(map: RuleScriptMap, ruleId: string): RuleScriptMap {
  const next = cloneMap(map);
  const rule = findRule(next, ruleId);
  if (rule) {
    rule.scripts = [];
  }
  return next;
}

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
