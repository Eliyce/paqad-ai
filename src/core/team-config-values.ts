export const TEAM_CONFIG_FILES = [
  'paqad.yaml',
  'models.yaml',
  'retrieval.yaml',
  'decisions.yaml',
  'authoring.yaml',
  'feature-development/workflow.yaml',
  'feature-development/specification.yaml',
  'feature-development/rules.yaml',
  'feature-development/reuse.yaml',
  'feature-development/checks.yaml',
  'feature-development/evidence.yaml',
  'feature-development/analytics.yaml',
] as const;

export type OwnTeamConfigFile = (typeof TEAM_CONFIG_FILES)[number];
export const GIT_WORKFLOW_COMMITS_FILE = 'git-workflow/commits.yaml' as const;
export type TeamConfigFile = OwnTeamConfigFile | typeof GIT_WORKFLOW_COMMITS_FILE;

export const TEAM_CONFIG_FILE_DESCRIPTIONS: Readonly<Record<TeamConfigFile, string>> = {
  'paqad.yaml': 'The package itself: on/off, updates, Claude Code install, HUD and Site Map.',
  'models.yaml': 'Which models paqad uses.',
  'retrieval.yaml': 'How paqad finds relevant code and docs (RAG).',
  'decisions.yaml': 'When paqad stops to ask you, in any workflow.',
  'authoring.yaml': 'How paqad writes and tests skills and helper agents, and its eval runs.',
  'feature-development/workflow.yaml':
    'Lanes, stage helpers, stage tracking, and per stage: effort, model, extra reads and instructions.',
  'feature-development/specification.yaml':
    'The spec pipeline, its questions, the final review and the experts.',
  'feature-development/rules.yaml': 'How project rules are loaded and enforced.',
  'feature-development/reuse.yaml':
    'The existing-code digest, the duplication gate and the create-vs-reuse pause.',
  'feature-development/checks.yaml':
    'What the checks stage runs and how: commands, parallel runs, flaky tests, mutation testing.',
  'feature-development/evidence.yaml':
    'The proof a change leaves: bundle, report, metrics, screenshots and enterprise outputs.',
  'feature-development/analytics.yaml': 'Analytics instrumentation (opt-in).',
  'git-workflow/commits.yaml': 'The commit rules (owned by the git-workflow skill).',
};

export interface YamlValueMap {
  toYaml: (legacy: string) => unknown;
  fromYaml: (yaml: unknown) => string;
  yamlEnum?: readonly string[];
  list?: true;
  zeroIsAuto?: true;
  retiredValues?: ReadonlyMap<string, string>;
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

function scalarText(value: unknown): string {
  return typeof value === 'string' ? value : String(value);
}

export function renameMap(pairs: Readonly<Record<string, string>>): YamlValueMap {
  const reverse = new Map(Object.entries(pairs).map(([legacy, yaml]) => [yaml, legacy]));
  return {
    toYaml: (legacy) => pairs[legacy.trim()] ?? legacy.trim(),
    fromYaml: (yaml) => {
      const text = scalarText(yaml).trim();
      return reverse.get(text) ?? text;
    },
  };
}

export function retiredValueMap(retired: Readonly<Record<string, string>>): YamlValueMap {
  const retiredValues = new Map(Object.entries(retired));
  const current = (value: string): string => retiredValues.get(value) ?? value;
  return {
    toYaml: (legacy) => current(legacy.trim()),
    fromYaml: (yaml) => current(scalarText(yaml).trim()),
    retiredValues,
  };
}

export function booleanEnumMap(whenTrue: string, whenFalse: string): YamlValueMap {
  return {
    toYaml: (legacy) => {
      const text = legacy.trim().toLowerCase();
      if (TRUTHY.has(text)) return whenTrue;
      if (FALSY.has(text)) return whenFalse;
      return legacy.trim();
    },
    fromYaml: (yaml) => {
      if (yaml === true) return 'true';
      if (yaml === false) return 'false';
      const text = scalarText(yaml).trim();
      if (text === whenTrue) return 'true';
      if (text === whenFalse) return 'false';
      return text;
    },
    yamlEnum: [whenTrue, whenFalse],
  };
}

export const ZERO_IS_AUTO: YamlValueMap = {
  toYaml: (legacy) => {
    const parsed = Number(legacy.trim());
    if (legacy.trim() !== '' && Number.isFinite(parsed)) return parsed === 0 ? 'auto' : parsed;
    return legacy.trim();
  },
  fromYaml: (yaml) => {
    const text = scalarText(yaml).trim();
    return text === 'auto' ? '0' : text;
  },
  yamlEnum: ['auto'],
  zeroIsAuto: true,
};

export const COMMA_LIST: YamlValueMap = {
  toYaml: (legacy) =>
    legacy
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ''),
  fromYaml: (yaml) =>
    Array.isArray(yaml)
      ? yaml
          .map((entry) => scalarText(entry).trim())
          .filter((entry) => entry !== '')
          .join(',')
      : scalarText(yaml).trim(),
  list: true,
};

const STRICT_TO_BLOCK = renameMap({ strict: 'block' });
const FAIL_TO_BLOCK = renameMap({ fail: 'block' });
const BLOCKING_ONLY = renameMap({ 'blocking-only': 'blocking_only' });
const ASK_OFTEN = renameMap({ strict: 'often', balanced: 'balanced', permissive: 'rarely' });

export interface TeamConfigHome {
  file: TeamConfigFile;
  path: readonly string[];
  yaml?: YamlValueMap;
  since: string;
}

const EXISTING = '1.0.0';

function home(file: TeamConfigFile, dotted: string, yaml?: YamlValueMap): TeamConfigHome {
  return yaml === undefined
    ? { file, path: dotted.split('.'), since: EXISTING }
    : { file, path: dotted.split('.'), yaml, since: EXISTING };
}

const WF = 'feature-development/workflow.yaml';
const SPEC = 'feature-development/specification.yaml';
const RULES = 'feature-development/rules.yaml';
const REUSE = 'feature-development/reuse.yaml';
const CHECKS = 'feature-development/checks.yaml';
const EVIDENCE = 'feature-development/evidence.yaml';
const ANALYTICS = 'feature-development/analytics.yaml';
const AUTHORING = 'authoring.yaml';

const STAGE_HOMES: Record<string, TeamConfigHome> = Object.fromEntries(
  ['planning', 'specification', 'development', 'review', 'checks', 'documentation_sync'].flatMap(
    (stage) => [
      [`stage_effort_${stage}`, home(WF, `stages.${stage}.effort`)],
      [`stage_model_${stage}`, home(WF, `stages.${stage}.model`)],
    ],
  ),
);

export const TEAM_CONFIG_HOMES: Readonly<Record<string, TeamConfigHome>> = {
  paqad_enable: home('paqad.yaml', 'enabled'),
  team_bootstrap_enabled: home('paqad.yaml', 'team_bootstrap.enabled'),
  auto_update: home('paqad.yaml', 'updates.automatic'),
  minimum_version: home('paqad.yaml', 'updates.minimum_version'),
  version_check_interval_hours: home('paqad.yaml', 'updates.check_every_hours'),
  site_map: home('paqad.yaml', 'site_map.enabled'),
  rules_discovery_private_packages: home(
    'paqad.yaml',
    'rules_discovery.private_packages',
    COMMA_LIST,
  ),
  hud_view: home('paqad.yaml', 'hud.band'),
  hud_chime: home('paqad.yaml', 'hud.chime'),
  plugin_migration: home('paqad.yaml', 'claude_code.plugin_migration'),
  claude_install_mode: home('paqad.yaml', 'claude_code.install_mode'),
  model_default: home('models.yaml', 'models.default'),
  model_reasoning: home('models.yaml', 'models.reasoning'),
  model_fast: home('models.yaml', 'models.fast'),
  rag_enabled: home('retrieval.yaml', 'enabled'),
  rag_embedding_provider: home('retrieval.yaml', 'embeddings.provider'),
  rag_embedding_model: home('retrieval.yaml', 'embeddings.model'),
  rag_similarity_threshold: home('retrieval.yaml', 'match.min_similarity'),
  rag_relief_floor: home('retrieval.yaml', 'match.fallback_min_similarity'),
  rag_top_n: home('retrieval.yaml', 'match.max_results'),
  rag_max_file_size: home('retrieval.yaml', 'index.max_file_size_bytes'),
  rag_base_branch: home('retrieval.yaml', 'index.base_branch'),
  decisions_ask_threshold: home('decisions.yaml', 'ask', {
    ...ASK_OFTEN,
    yamlEnum: ['often', 'balanced', 'rarely'],
  }),
  ai_attribution: home(GIT_WORKFLOW_COMMITS_FILE, 'ai_attribution'),
  spec_only_mode: home(WF, 'stop_after', booleanEnumMap('specification', 'none')),
  market_research: home(WF, 'stages.planning.research.market'),
  design_research: home(WF, 'stages.planning.research.design'),
  team_agents: home(WF, 'stage_helpers.team_agents'),
  ...STAGE_HOMES,
  stages_mode: home(WF, 'stage_tracking', STRICT_TO_BLOCK),
  stage_isolation_lanes: home(WF, 'stage_helpers.on_lanes', COMMA_LIST),
  spec_pipeline_enabled: home(SPEC, 'pipeline.enabled'),
  spec_pipeline_clarification: home(SPEC, 'questions', STRICT_TO_BLOCK),
  spec_pipeline_final_review: home(SPEC, 'final_review', STRICT_TO_BLOCK),
  spec_pipeline_token_ceiling: home(SPEC, 'pipeline.max_tokens'),
  spec_grounding_budget_ms: home(SPEC, 'pipeline.grounding_timeout_ms'),
  spec_pipeline_experts_enabled: home(SPEC, 'experts.enabled'),
  spec_pipeline_adoption: home(SPEC, 'hand_written_specs', STRICT_TO_BLOCK),
  spec_pipeline_experts_lanes: home(SPEC, 'experts.standing_on_lanes', COMMA_LIST),
  spec_pipeline_standing_experts: home(SPEC, 'experts.standing', COMMA_LIST),
  lean_rules: home(RULES, 'loading', booleanEnumMap('lean', 'full')),
  rule_compliance: home(RULES, 'enforcement', STRICT_TO_BLOCK),
  rule_gate_pre_edit: home(RULES, 'before_edit.run', BLOCKING_ONLY),
  rule_gate_concurrency: home(RULES, 'max_parallel'),
  rule_gate_budget_ms: home(RULES, 'before_edit.budget_ms'),
  existing_surface_tokens: home(REUSE, 'existing_code_digest.max_tokens'),
  duplication_mode: home(REUSE, 'duplication.gate', STRICT_TO_BLOCK),
  duplication_similarity_threshold: home(REUSE, 'duplication.min_similarity'),
  duplication_min_lines: home(REUSE, 'duplication.min_lines'),
  decision_arm_mode: home(REUSE, 'create_vs_reuse.pause', STRICT_TO_BLOCK),
  decision_arm_plan_threshold: home(REUSE, 'create_vs_reuse.min_similarity'),
  decision_arm_max_per_change: home(REUSE, 'create_vs_reuse.max_pauses_per_change'),
  checks_parallel: home(CHECKS, 'parallel'),
  checks_max_processes: home(CHECKS, 'max_processes', ZERO_IS_AUTO),
  mutation_mode: home(CHECKS, 'mutation_testing', STRICT_TO_BLOCK),
  checks_flaky_under_parallel: home(CHECKS, 'flaky_tests', FAIL_TO_BLOCK),
  enterprise: home(EVIDENCE, 'enterprise.enabled'),
  enterprise_evidence_ledger: home(EVIDENCE, 'enterprise.ledger'),
  enterprise_ai_bom: home(EVIDENCE, 'enterprise.ai_bom'),
  enterprise_compliance_citations: home(EVIDENCE, 'enterprise.compliance_citations'),
  visual_evidence: home(EVIDENCE, 'screenshots.enabled'),
  feature_report: home(EVIDENCE, 'report'),
  metrics_enabled: home(EVIDENCE, 'change_metrics'),
  bundle_completeness: home(EVIDENCE, 'bundle', STRICT_TO_BLOCK),
  visual_evidence_mode: home(EVIDENCE, 'screenshots.gate', STRICT_TO_BLOCK),
  evidence_existence_gate: home(
    EVIDENCE,
    'legacy_existence_check',
    retiredValueMap({ strict: 'warn' }),
  ),
  analytics_instrumentation: home(ANALYTICS, 'enabled'),
  analytics_strictness: home(ANALYTICS, 'gate', STRICT_TO_BLOCK),
  skill_orchestrator_enabled: home(AUTHORING, 'skills.enabled'),
  authoring_trigger_threshold: home(AUTHORING, 'skills.trigger_threshold'),
  authoring_trigger_min_runs: home(AUTHORING, 'skills.trigger_min_runs'),
  skill_eval_min_gain_points: home(AUTHORING, 'skills.eval_min_gain_points'),
  skill_eval_max_token_multiple: home(AUTHORING, 'skills.eval_max_token_multiple'),
  authoring_fact_max_age_days: home(AUTHORING, 'skills.fact_max_age_days'),
  authoring_collision_jaccard: home(AUTHORING, 'skills.collision_jaccard'),
  authoring_description_budget_chars: home(AUTHORING, 'skills.description_budget_chars'),
  skill_body_max_tokens: home(AUTHORING, 'skills.body_max_tokens'),
  authoring_regression_tolerance: home(AUTHORING, 'skills.regression_tolerance'),
  authoring_dark_window_days: home(AUTHORING, 'skills.dark_window_days'),
  agent_orchestrator_enabled: home(AUTHORING, 'agents.enabled'),
  agent_pass_k_threshold: home(AUTHORING, 'agents.pass_k_threshold'),
  agent_stage_pass_k_threshold: home(AUTHORING, 'agents.stage_pass_k_threshold'),
  agent_delegation_threshold: home(AUTHORING, 'agents.delegation_threshold'),
  agent_description_max_tokens: home(AUTHORING, 'agents.description_max_tokens'),
  agent_report_max_tokens: home(AUTHORING, 'agents.report_max_tokens'),
  agent_prompt_max_tokens: home(AUTHORING, 'agents.prompt_max_tokens'),
  agent_max_tools: home(AUTHORING, 'agents.max_tools'),
  agent_max_cost_multiple: home(AUTHORING, 'agents.max_cost_multiple'),
  agent_catalog_description_max_tokens: home(AUTHORING, 'agents.catalog_description_max_tokens'),
  agent_memory_max_lines: home(AUTHORING, 'agents.memory_max_lines'),
  authoring_runs_per_arm: home(AUTHORING, 'runs.per_arm'),
  authoring_max_iterations: home(AUTHORING, 'runs.max_iterations'),
  authoring_tool_result_max_tokens: home(AUTHORING, 'runs.tool_result_max_tokens'),
  authoring_cache_hit_min: home(AUTHORING, 'runs.cache_hit_min'),
  authoring_batch_mode: home(AUTHORING, 'runs.batch'),
  authoring_run_max_cost_usd: home(AUTHORING, 'runs.max_cost_usd'),
  authoring_otel_endpoint: home(AUTHORING, 'runs.otel_endpoint'),
};

export function teamConfigHome(key: string): TeamConfigHome {
  const found = TEAM_CONFIG_HOMES[key];
  if (found === undefined) {
    throw new Error(`Setting ${key} has no home in the team YAML files.`);
  }
  return found;
}

export interface TranslatableSpec {
  type: 'boolean' | 'number' | 'string' | 'enum';
  default: boolean | number | string | undefined;
  enumValues?: readonly string[];
  yaml?: YamlValueMap;
}

export function toYamlValue(spec: TranslatableSpec, legacy: string): unknown {
  if (spec.yaml !== undefined) return spec.yaml.toYaml(legacy);
  const text = legacy.trim();
  if (spec.type === 'boolean') {
    const lower = text.toLowerCase();
    if (TRUTHY.has(lower)) return true;
    if (FALSY.has(lower)) return false;
    return text;
  }
  if (spec.type === 'number') {
    const parsed = Number(text);
    return text !== '' && Number.isFinite(parsed) ? parsed : text;
  }
  return text;
}

export function fromYamlValue(spec: TranslatableSpec, yaml: unknown): string {
  if (spec.yaml !== undefined) return spec.yaml.fromYaml(yaml);
  return scalarText(yaml).trim();
}

export function yamlDefault(spec: TranslatableSpec): unknown {
  return spec.default === undefined ? undefined : toYamlValue(spec, String(spec.default));
}

export function yamlEnumOf(spec: TranslatableSpec): readonly string[] | undefined {
  if (spec.yaml?.zeroIsAuto || spec.yaml?.list) return undefined;
  if (spec.yaml?.yamlEnum !== undefined) return spec.yaml.yamlEnum;
  if (spec.enumValues === undefined) return undefined;
  return spec.enumValues.map((value) => scalarText(toYamlValue(spec, value)));
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isNumeric(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
}

export function checkYamlValue(spec: TranslatableSpec, yaml: unknown): string | null {
  if (spec.yaml?.list) {
    if (typeof yaml === 'string') return null;
    return Array.isArray(yaml) && yaml.every(isScalar) ? null : 'It must be a list of names.';
  }
  if (spec.yaml?.zeroIsAuto) {
    return yaml === 'auto' || isNumeric(yaml) ? null : 'It must be a number or auto.';
  }
  if (isScalar(yaml) && spec.yaml?.retiredValues?.has(scalarText(yaml).trim())) return null;
  const allowed = yamlEnumOf(spec);
  if (allowed !== undefined) {
    return isScalar(yaml) && allowed.includes(scalarText(yaml).trim())
      ? null
      : `It must be one of: ${allowed.join(', ')}.`;
  }
  if (spec.type === 'boolean') {
    if (typeof yaml === 'boolean') return null;
    return typeof yaml === 'string' &&
      (TRUTHY.has(yaml.trim().toLowerCase()) || FALSY.has(yaml.trim().toLowerCase()))
      ? null
      : 'It must be true or false.';
  }
  if (spec.type === 'number') return isNumeric(yaml) ? null : 'It must be a number.';
  return isScalar(yaml) ? null : 'It must be a single value.';
}

export function personalValue(spec: TranslatableSpec | undefined, raw: string): string {
  if (spec?.yaml === undefined || spec.yaml.list) return raw;
  return spec.yaml.fromYaml(raw);
}
