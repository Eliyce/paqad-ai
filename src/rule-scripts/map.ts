// Load / serialize the rule-script map (issue #89).
//
// The map is YAML for human review in PRs. Reads are unrestricted; every write
// goes through src/rule-scripts/apply.ts (single-writer invariant).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';

import { RULE_SCRIPT_MAP_SCHEMA_VERSION, type RuleScriptMap } from './types.js';

export function ruleScriptMapPath(projectRoot: string): string {
  return join(projectRoot, PATHS.RULE_SCRIPT_MAP);
}

export function emptyRuleScriptMap(now: Date = new Date()): RuleScriptMap {
  return {
    schema_version: RULE_SCRIPT_MAP_SCHEMA_VERSION,
    generated_at: now.toISOString(),
    rule_files_hash: '',
    rules: [],
  };
}

export function loadRuleScriptMap(projectRoot: string): RuleScriptMap | null {
  const path = ruleScriptMapPath(projectRoot);
  if (!existsSync(path)) {
    return null;
  }
  const parsed = YAML.parse(readFileSync(path, 'utf8')) as RuleScriptMap | null;
  return parsed ?? null;
}

export function serializeRuleScriptMap(map: RuleScriptMap): string {
  // Stable key order and 2-space indent keep diffs reviewable.
  return YAML.stringify(map, { indent: 2, lineWidth: 0 });
}
