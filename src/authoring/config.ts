import {
  AUTHORING_BATCH_MODES,
  AUTHORING_SECTION,
  FRAMEWORK_CONFIG_SPECS,
  layeredConfigMap,
  type AuthoringBatchMode,
} from '@/core/framework-config.js';

export interface AuthoringConfig {
  skill_orchestrator_enabled: boolean;
  authoring_trigger_threshold: number;
  authoring_trigger_min_runs: number;
  skill_eval_min_gain_points: number;
  skill_eval_max_token_multiple: number;
  authoring_runs_per_arm: number;
  authoring_max_iterations: number;
  authoring_fact_max_age_days: number;
  authoring_collision_jaccard: number;
  authoring_description_budget_chars: number;
  skill_body_max_tokens: number;
  authoring_tool_result_max_tokens: number;
  authoring_cache_hit_min: number;
  authoring_regression_tolerance: number;
  authoring_dark_window_days: number;
  authoring_batch_mode: AuthoringBatchMode;
  authoring_run_max_cost_usd: number;
  authoring_otel_endpoint: string;
}

export type AuthoringConfigKey = keyof AuthoringConfig;

type RangeKind = 'boolean' | 'share' | 'count' | 'multiple' | 'cost' | 'batch' | 'endpoint';

const RANGE_OF: Record<AuthoringConfigKey, RangeKind> = {
  skill_orchestrator_enabled: 'boolean',
  authoring_trigger_threshold: 'share',
  authoring_trigger_min_runs: 'count',
  skill_eval_min_gain_points: 'count',
  skill_eval_max_token_multiple: 'multiple',
  authoring_runs_per_arm: 'count',
  authoring_max_iterations: 'count',
  authoring_fact_max_age_days: 'count',
  authoring_collision_jaccard: 'share',
  authoring_description_budget_chars: 'count',
  skill_body_max_tokens: 'count',
  authoring_tool_result_max_tokens: 'count',
  authoring_cache_hit_min: 'share',
  authoring_regression_tolerance: 'share',
  authoring_dark_window_days: 'count',
  authoring_batch_mode: 'batch',
  authoring_run_max_cost_usd: 'cost',
  authoring_otel_endpoint: 'endpoint',
};

const ALLOWED_TEXT: Record<RangeKind, string> = {
  boolean: 'true or false',
  share: 'a number from 0 to 1',
  count: 'a positive whole number',
  multiple: 'a number of 1 or more',
  cost: 'a number above 0',
  batch: AUTHORING_BATCH_MODES.join(' or '),
  endpoint: 'empty or an http(s) URL',
};

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

export const AUTHORING_CONFIG_KEYS: readonly AuthoringConfigKey[] = Object.keys(
  RANGE_OF,
) as AuthoringConfigKey[];

function defaultOf(key: AuthoringConfigKey): boolean | number | string {
  const spec = FRAMEWORK_CONFIG_SPECS.find(
    (entry) => entry.key === key && entry.section === AUTHORING_SECTION,
  );
  if (spec?.default === undefined) {
    throw new Error(`authoring config key ${key} has no spec in FRAMEWORK_CONFIG_SPECS`);
  }
  return spec.default;
}

function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseValue(kind: RangeKind, raw: string): boolean | number | string | undefined {
  const text = raw.trim();
  if (kind === 'boolean') {
    const lower = text.toLowerCase();
    if (TRUTHY.has(lower)) return true;
    if (FALSY.has(lower)) return false;
    return undefined;
  }
  if (kind === 'batch') {
    return (AUTHORING_BATCH_MODES as readonly string[]).includes(text) ? text : undefined;
  }
  if (kind === 'endpoint') {
    return text === '' || isHttpUrl(text) ? text : undefined;
  }
  if (text === '') return undefined;
  const value = Number(text);
  if (!Number.isFinite(value)) return undefined;
  switch (kind) {
    case 'share':
      return value >= 0 && value <= 1 ? value : undefined;
    case 'count':
      return Number.isInteger(value) && value > 0 ? value : undefined;
    case 'multiple':
      return value >= 1 ? value : undefined;
    case 'cost':
      return value > 0 ? value : undefined;
  }
}

export interface AuthoringConfigProblem {
  key: AuthoringConfigKey;
  value: string;
  allowed: string;
}

export function authoringConfigProblems(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): AuthoringConfigProblem[] {
  const map = layeredConfigMap(projectRoot, env);
  const problems: AuthoringConfigProblem[] = [];
  for (const key of AUTHORING_CONFIG_KEYS) {
    const raw = map.get(key);
    if (raw === undefined) continue;
    if (parseValue(RANGE_OF[key], raw) === undefined) {
      problems.push({ key, value: raw, allowed: ALLOWED_TEXT[RANGE_OF[key]] });
    }
  }
  return problems;
}

export function readAuthoringConfig(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): AuthoringConfig {
  const map = layeredConfigMap(projectRoot, env);
  const config: Record<string, boolean | number | string> = {};
  for (const key of AUTHORING_CONFIG_KEYS) {
    const raw = map.get(key);
    const parsed = raw === undefined ? undefined : parseValue(RANGE_OF[key], raw);
    config[key] = parsed ?? defaultOf(key);
  }
  return config as unknown as AuthoringConfig;
}

export function skillOrchestratorEnabled(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return readAuthoringConfig(projectRoot, env).skill_orchestrator_enabled;
}
