export type { SkillCacheEntry } from './context.js';

export const SKILL_MODEL_TIERS = ['fast', 'medium', 'reasoning'] as const;
export type SkillModelTier = (typeof SKILL_MODEL_TIERS)[number];
export const SKILL_OUTPUT_FORMATS = ['markdown', 'yaml', 'json'] as const;
export type SkillOutputFormat = (typeof SKILL_OUTPUT_FORMATS)[number];

export interface SkillTriggerCondition {
  [dimension: string]: string[];
}

export interface SkillRequestRoutingRule {
  priority: number;
  patterns: string[];
  target_workflow: string;
}

export interface SkillInputSchemaField {
  type: 'string' | 'string[]' | 'boolean' | 'path' | 'path[]' | 'object';
  required: boolean;
  description?: string;
}

export interface SkillInputSchema {
  [name: string]: SkillInputSchemaField;
}

export interface SkillCompletionTrigger {
  emit: string;
  triggers: string[];
}

export interface SkillDefinition {
  name: string;
  description: string;
  file: string;
  model_tier: SkillModelTier;
  triggers: SkillTriggerCondition[];
  request_routing?: SkillRequestRoutingRule[];
  max_lines: number;
  cacheable: boolean;
  cache_key_inputs: string[];
  output_format: SkillOutputFormat;
  input_schema: SkillInputSchema;
  on_complete?: SkillCompletionTrigger;
  tools?: string[];
  max_output_tokens?: number;
}

export interface LoadedSkill extends SkillDefinition {
  body: string;
  line_count: number;
}

/** Origin of a skill in a merged listing. */
export type SkillSource = 'built-in' | 'runtime';

/** In-memory input shape for hot-registering a skill (no disk path required). */
export interface RuntimeSkillDescriptor {
  /** Raw SKILL.md markdown content. */
  content: string;
  /** Optional label used to build the synthetic `file` value. */
  sourceLabel?: string;
}

/** A skill in a {@link RuntimeSkillRegistry} snapshot, tagged with its origin and id. */
export interface RuntimeSkillListEntry extends LoadedSkill {
  /** Namespaced identifier: the skill name for built-ins, `runtime:<name>` for runtime entries. */
  id: string;
  source: SkillSource;
}

export interface SkillResult {
  skill_name: string;
  findings: string[];
  output_paths: string[];
  cache_hit: boolean;
}

export interface SkillCacheResult {
  hit: boolean;
  result?: unknown;
  input_hash?: string;
}

export interface CacheStats {
  total_entries: number;
  total_size_bytes: number;
  hit_rate: number;
}
