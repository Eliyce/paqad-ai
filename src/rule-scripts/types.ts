// Rules-as-scripts type contract (issue #89).
//
// The rule-script map (docs/instructions/rules/rule-script-map.yml) is the
// single source of truth linking each prose rule under docs/instructions/rules
// to its verification scripts. It is written only by src/rule-scripts/apply.ts.

export const RULE_SCRIPT_MAP_SCHEMA_VERSION = 1 as const;

export type VerifiabilityKind = 'deterministic' | 'heuristic' | 'unverifiable';

export type ScriptScope = 'changed-files' | 'whole-tree' | 'git-diff' | 'git-history';

export interface Verifiability {
  kind: VerifiabilityKind;
  // Required when kind === 'unverifiable'; optional otherwise.
  reason?: string;
}

export interface ScriptEntry {
  // Project-relative path to the .mjs script.
  path: string;
  kind: Exclude<VerifiabilityKind, 'unverifiable'>;
  runtime: 'node';
  scope: ScriptScope;
  // ISO timestamp of the last successful fixture validation.
  last_validated_at: string;
  fixtures_passed: boolean;
}

export interface RuleEntry {
  // Opaque stable id, e.g. RL-7f3a. Embedded as <!-- @rule RL-7f3a --> in the
  // source markdown bullet. Stable across edits, renames, and file moves.
  id: string;
  // Project-relative path of the markdown file the rule lives in.
  source: string;
  // Verbatim rule text (the bullet, marker stripped).
  text: string;
  // sha256 of the rule text — drives RS-RULE-EDITED drift detection.
  text_hash: string;
  verifiability: Verifiability;
  // Pre-existing enforcers (e.g. "eslint:no-debugger", "tsconfig:strict").
  // When non-empty, no script is generated for the rule.
  enforced_by: string[];
  scripts: ScriptEntry[];
}

export interface RuleScriptMap {
  schema_version: typeof RULE_SCRIPT_MAP_SCHEMA_VERSION;
  generated_at: string;
  // sha256 over all rule-file paths + contents at generation time.
  rule_files_hash: string;
  rules: RuleEntry[];
  // Rules removed from markdown but kept until the next regen cycle (delayed
  // delete). Their scripts remain on disk until reconciliation prunes them.
  archived?: RuleEntry[];
}
