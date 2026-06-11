// Deterministic support for the rule-analyzer skill (issue #89).
//
// The skill owns the judgement calls (verifiability classification, conflict
// detection, existing-enforcer detection). This module owns the deterministic
// mechanics: enumerate rule files, hash them, embed stable ids into the
// markdown, and assemble the map from the inventory + the skill's classifications.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import fg from 'fast-glob';

import { PATHS } from '@/core/constants/paths.js';
import { toPosixPath } from '@/core/path-utils.js';

import { embedRuleIds } from './rule-file.js';
import { sha256 } from './rule-id.js';
import { RULE_SCRIPT_MAP_SCHEMA_VERSION, type RuleEntry, type RuleScriptMap } from './types.js';

export interface RuleInventoryItem {
  id: string;
  source: string;
  text: string;
  text_hash: string;
  isNew: boolean;
}

export interface ScanResult {
  inventory: RuleInventoryItem[];
  files: string[];
  rule_files_hash: string;
  // Files whose content changed because a marker was embedded.
  changed_files: string[];
}

// Markdown rule files under docs/instructions/rules, sorted for stable hashing.
// The .yml registries (module-map, rule-script-map) are not prose rules.
export function collectRuleFiles(projectRoot: string): string[] {
  const rel = fg.sync('**/*.md', {
    cwd: join(projectRoot, PATHS.RULES_DIR),
    onlyFiles: true,
  });
  return rel.map((r) => toPosixPath(join(PATHS.RULES_DIR, r))).sort();
}

export function computeRuleFilesHash(projectRoot: string, files: string[]): string {
  const parts = files
    .slice()
    .sort()
    .map((rel) => `${rel}\n${readFileSync(join(projectRoot, rel), 'utf8')}`);
  return `sha256-${sha256(parts.join('\n'))}`;
}

// Walk every rule file, embed stable ids into unmarked bullets (writing the
// files back when they change), and return the full rule inventory. Idempotent:
// a second run mints no new ids and rewrites no files.
export function scanAndEmbedIds(projectRoot: string): ScanResult {
  const files = collectRuleFiles(projectRoot);
  const taken = new Set<string>();
  const inventory: RuleInventoryItem[] = [];
  const changed: string[] = [];

  for (const rel of files) {
    const abs = join(projectRoot, rel);
    const before = readFileSync(abs, 'utf8');
    const { content, rules } = embedRuleIds(rel, before, taken);
    if (content !== before) {
      writeFileSync(abs, content, 'utf8');
      changed.push(rel);
    }
    for (const r of rules) {
      inventory.push({
        id: r.id,
        source: rel,
        text: r.text,
        text_hash: r.text_hash,
        isNew: r.isNew,
      });
    }
  }

  // Hash is computed after embedding so it reflects the persisted on-disk state.
  return {
    inventory,
    files,
    rule_files_hash: computeRuleFilesHash(projectRoot, files),
    changed_files: changed,
  };
}

export interface RuleClassification {
  id: string;
  verifiability: RuleEntry['verifiability'];
  enforced_by: string[];
}

// Assemble the map from the inventory + the skill's classifications. When a
// prior map is supplied, scripts are carried over for rules whose text_hash is
// unchanged (per-rule selective invalidation — no global rebuild).
export function assembleMap(
  inventory: RuleInventoryItem[],
  classifications: Map<string, RuleClassification>,
  rule_files_hash: string,
  priorMap: RuleScriptMap | null,
  now: Date = new Date(),
): RuleScriptMap {
  const priorById = new Map<string, RuleEntry>();
  for (const r of priorMap?.rules ?? []) {
    priorById.set(r.id, r);
  }

  const rules: RuleEntry[] = inventory.map((item) => {
    const cls = classifications.get(item.id);
    const prior = priorById.get(item.id);
    const carryScripts =
      prior !== undefined && prior.text_hash === item.text_hash ? prior.scripts : [];
    return {
      id: item.id,
      source: item.source,
      text: item.text,
      text_hash: item.text_hash,
      verifiability: cls?.verifiability ?? prior?.verifiability ?? { kind: 'heuristic' },
      enforced_by: cls?.enforced_by ?? prior?.enforced_by ?? [],
      scripts: carryScripts,
    };
  });

  return {
    schema_version: RULE_SCRIPT_MAP_SCHEMA_VERSION,
    generated_at: now.toISOString(),
    rule_files_hash,
    rules,
  };
}
