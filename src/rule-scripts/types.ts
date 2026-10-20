export const RULE_SCRIPT_MAP_SCHEMA_VERSION = 1 as const;

export type VerifiabilityKind = 'deterministic' | 'heuristic' | 'unverifiable';

export type ScriptScope = 'changed-files' | 'whole-tree' | 'git-diff' | 'git-history';

export interface Verifiability {
  kind: VerifiabilityKind;
  reason?: string;
}

export interface ScriptEntry {
  path: string;
  kind: Exclude<VerifiabilityKind, 'unverifiable'>;
  runtime: 'node';
  scope: ScriptScope;
  last_validated_at: string;
  fixtures_passed: boolean;
}

export interface RuleEntry {
  id: string;
  source: string;
  text: string;
  text_hash: string;
  verifiability: Verifiability;
  enforced_by: string[];
  scripts: ScriptEntry[];
}

export interface RuleScriptMap {
  schema_version: typeof RULE_SCRIPT_MAP_SCHEMA_VERSION;
  generated_at: string;
  rule_files_hash: string;
  rules: RuleEntry[];
  archived?: RuleEntry[];
}
