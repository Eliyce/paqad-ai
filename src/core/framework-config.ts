import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from './constants/paths.js';
import { readTeamConfig, type TeamConfigRead } from './team-config.js';
import { listConfigsFiles } from './team-config-legacy.js';
import {
  GIT_WORKFLOW_COMMITS_FILE,
  personalValue,
  TEAM_CONFIG_FILE_DESCRIPTIONS,
  TEAM_CONFIG_FILES,
  teamConfigHome,
  yamlDefault,
  yamlEnumOf,
  type TeamConfigFile,
  type YamlValueMap,
} from './team-config-values.js';
import { isHigherStamp } from './team-file-schema.js';
import { versionAtLeast } from './version-compare.js';
import { normalizeIntelligenceConfig } from './project-intelligence.js';
import { LANES, type Lane } from './types/routing.js';
import type {
  DecisionProfileConfig,
  EfficiencyConfig,
  EnterpriseConfig,
  IntelligenceConfig,
  ModelRoutingConfig,
  ProjectFeatureFlags,
  ProjectProfile,
} from './types/project-profile.js';

declare const __PKG_VERSION__: string;

export const LEGACY_TEAM_CONFIG_READ_UNTIL = '2027-02-01';

const EMBEDDING_PROVIDERS = ['local', 'openai'] as const;
const ASK_THRESHOLDS = ['strict', 'balanced', 'permissive'] as const;
const STAGE_RULE_MODES = ['off', 'warn', 'strict'] as const;
const CHECKS_FLAKY_MODES = ['pass', 'warn', 'fail'] as const;
const SPEC_PIPELINE_ADOPTION_MODES = ['warn', 'strict'] as const;
export const RULE_GATE_PRE_EDIT_MODES = ['blocking-only', 'all'] as const;
export type RuleGatePreEditMode = (typeof RULE_GATE_PRE_EDIT_MODES)[number];
export const RULE_GATE_DEFAULTS = {
  pre_edit: 'blocking-only' as RuleGatePreEditMode,
  budget_ms: 6000,
  min_budget_ms: 500,
  max_budget_ms: 9000,
  max_concurrency: 8,
};
export type SpecPipelineAdoptionMode = (typeof SPEC_PIPELINE_ADOPTION_MODES)[number];

export const SPEC_PIPELINE_DEFAULTS: Readonly<{
  spec_pipeline_enabled: boolean;
  spec_pipeline_experts_enabled: boolean;
  spec_pipeline_adoption: SpecPipelineAdoptionMode;
}> = Object.freeze({
  spec_pipeline_enabled: true,
  spec_pipeline_experts_enabled: true,
  spec_pipeline_adoption: 'strict',
});
const VISUAL_EVIDENCE_MODES = ['warn', 'strict'] as const;
const EVIDENCE_EXISTENCE_MODES = ['off', 'warn'] as const;
const AI_ATTRIBUTION_MODES = ['keep', 'strip'] as const;
const PLUGIN_MIGRATION_MODES = ['on', 'off'] as const;
const CLAUDE_INSTALL_MODES = ['auto', 'plugin', 'settings'] as const;
export const AUTHORING_BATCH_MODES = ['auto', 'off'] as const;
export type AuthoringBatchMode = (typeof AUTHORING_BATCH_MODES)[number];
export const AUTHORING_SECTION = 'Skill and agent authoring';
export const STAGE_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'inherit'] as const;
export type StageEffort = (typeof STAGE_EFFORT_LEVELS)[number];
export const STAGE_MODELS = ['inherit', 'haiku', 'sonnet', 'opus'] as const;
export type StageModel = (typeof STAGE_MODELS)[number];
export const STAGE_SETTING_STAGES = [
  'planning',
  'specification',
  'development',
  'review',
  'checks',
  'documentation_sync',
] as const;
const STAGE_EFFORT_DEFAULTS: Readonly<Record<string, StageEffort>> = {
  planning: 'high',
  specification: 'high',
  development: 'inherit',
  review: 'high',
  checks: 'low',
  documentation_sync: 'low',
};
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

type ConfigValueType = 'boolean' | 'number' | 'string' | 'enum';

export type ConfigGroup = 'app' | 'rag' | 'models' | 'policy';

interface BaseConfigSpec {
  key: string;
  env: string;
  type: ConfigValueType;
  default: boolean | number | string | undefined;
  enumValues?: readonly string[];
  optional?: boolean;
  group: ConfigGroup;
  section: string;
  comment: string;
}

export interface FrameworkConfigSpec extends BaseConfigSpec {
  file: TeamConfigFile;
  path: readonly string[];
  yaml?: YamlValueMap;
  since: string;
}

const BASE_CONFIG_SPECS: readonly BaseConfigSpec[] = [
  {
    key: 'paqad_enable',
    env: 'PAQAD_ENABLE',
    type: 'boolean',
    default: true,
    group: 'app',
    section: 'Framework master switch',
    comment: 'Turns paqad on or off for this project, and false lets you work without paqad.',
  },
  {
    key: 'team_bootstrap_enabled',
    env: 'PAQAD_TEAM_BOOTSTRAP_ENABLED',
    type: 'boolean',
    default: true,
    group: 'app',
    section: 'Team and cloud setup',
    comment:
      'Lets teammates and Claude Code cloud sessions set paqad up from this repo on their own.',
  },
  {
    key: 'auto_update',
    env: 'PAQAD_AUTO_UPDATE',
    type: 'boolean',
    default: true,
    group: 'app',
    section: 'Version & updates',
    comment: 'Pulls newer paqad versions in the background when a session starts.',
  },
  {
    key: 'minimum_version',
    env: 'PAQAD_MINIMUM_VERSION',
    type: 'string',
    default: 'latest',
    group: 'app',
    section: 'Version & updates',
    comment:
      'The lowest paqad version this project runs on, where latest always tracks the newest version.',
  },
  {
    key: 'version_check_interval_hours',
    env: 'PAQAD_VERSION_CHECK_INTERVAL_HOURS',
    type: 'number',
    default: 12,
    group: 'app',
    section: 'Version & updates',
    comment: 'How many hours pass between background checks for a newer paqad version.',
  },
  {
    key: 'enterprise',
    env: 'PAQAD_ENTERPRISE',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Enterprise / governance (licensed, off by default)',
    comment: 'Turns on the enterprise and governance outputs as a group.',
  },
  {
    key: 'enterprise_evidence_ledger',
    env: 'PAQAD_ENTERPRISE_EVIDENCE_LEDGER',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Enterprise / governance (licensed, off by default)',
    comment: 'Writes the receipt and evidence ledger for each change under .paqad/ledger/.',
  },
  {
    key: 'enterprise_ai_bom',
    env: 'PAQAD_ENTERPRISE_AI_BOM',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Enterprise / governance (licensed, off by default)',
    comment: 'Writes an AI bill of materials (ai-bom.json, in CycloneDX format) for each change.',
  },
  {
    key: 'enterprise_compliance_citations',
    env: 'PAQAD_ENTERPRISE_COMPLIANCE_CITATIONS',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Enterprise / governance (licensed, off by default)',
    comment: 'Adds compliance framework citations to the receipt, which spends extra tokens.',
  },
  {
    key: 'spec_only_mode',
    env: 'PAQAD_SPEC_ONLY_MODE',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Feature flags',
    comment: 'Stops a change once the spec is written, so nothing is implemented.',
  },
  {
    key: 'market_research',
    env: 'PAQAD_MARKET_RESEARCH',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Feature flags',
    comment: 'Runs the market research helper during planning.',
  },
  {
    key: 'design_research',
    env: 'PAQAD_DESIGN_RESEARCH',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Feature flags',
    comment: 'Runs the design research helper during planning.',
  },
  {
    key: 'team_agents',
    env: 'PAQAD_TEAM_AGENTS',
    type: 'boolean',
    default: true,
    group: 'app',
    section: 'Feature flags',
    comment: 'Uses a team of helper agents for work on the full lane.',
  },
  {
    key: 'analytics_instrumentation',
    env: 'PAQAD_ANALYTICS_INSTRUMENTATION',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Feature flags',
    comment:
      'Lets paqad wire analytics tracking into the app and keep a tracking plan doc for each event.',
  },
  {
    key: 'site_map',
    env: 'PAQAD_SITE_MAP',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Feature flags',
    comment:
      "Keeps a checked map of the app's screens and user journeys under docs/site-map/ for coding projects.",
  },
  {
    key: 'rules_discovery_private_packages',
    env: 'PAQAD_RULES_DISCOVERY_PRIVATE_PACKAGES',
    type: 'string',
    default: '',
    group: 'app',
    section: 'Feature flags',
    comment:
      'Package names or patterns (use * for any text) that rules discovery treats as private and never looks up on the web.',
  },
  {
    key: 'visual_evidence',
    env: 'PAQAD_VISUAL_EVIDENCE',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Feature flags',
    comment:
      'Captures screenshots of documented flows as proof for frontend changes in coding projects.',
  },
  {
    key: 'lean_rules',
    env: 'PAQAD_LEAN_RULES',
    type: 'boolean',
    default: true,
    group: 'app',
    section: 'Feature flags',
    comment:
      'Loads only the rule text that applies to the files in play, instead of every rule in full each session.',
  },
  {
    key: 'feature_report',
    env: 'PAQAD_FEATURE_REPORT',
    type: 'boolean',
    default: true,
    group: 'app',
    section: 'Feature flags',
    comment:
      'Writes a local evidence report page for each change when it finishes, at no model cost.',
  },
  {
    key: 'metrics_enabled',
    env: 'PAQAD_METRICS_ENABLED',
    type: 'boolean',
    default: true,
    group: 'app',
    section: 'Feature flags',
    comment:
      'Measures duplication and reuse in the new code of each change and shows them on the receipt and dashboard.',
  },
  {
    key: 'checks_parallel',
    env: 'PAQAD_CHECKS_PARALLEL',
    type: 'boolean',
    default: true,
    group: 'app',
    section: 'Feature flags',
    comment:
      "Runs the checks at the same time, using the test runner's own parallel mode when it has one.",
  },
  {
    key: 'checks_max_processes',
    env: 'PAQAD_CHECKS_MAX_PROCESSES',
    type: 'number',
    default: 0,
    group: 'app',
    section: 'Feature flags',
    comment:
      'The most test processes that run at once, where auto uses the CPU cores minus one within memory limits.',
  },
  {
    key: 'hud_view',
    env: 'PAQAD_HUD_VIEW',
    type: 'boolean',
    default: true,
    group: 'app',
    section: 'Feature flags',
    comment:
      'Shows the paqad status band above the prompt in the Claude Code plugin, along with the /paqad command.',
  },
  {
    key: 'hud_chime',
    env: 'PAQAD_HUD_CHIME',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Feature flags',
    comment: 'Plays a short chime in the Claude Code plugin once each verdict lands.',
  },
  {
    key: 'plugin_migration',
    env: 'PAQAD_PLUGIN_MIGRATION',
    type: 'enum',
    enumValues: PLUGIN_MIGRATION_MODES,
    default: 'off',
    group: 'app',
    section: 'Claude Code plugin migration',
    comment:
      'Moves existing npm Claude Code users to the paqad plugin in the background, with npm kept as the fallback.',
  },
  {
    key: 'claude_install_mode',
    env: 'PAQAD_CLAUDE_INSTALL_MODE',
    type: 'enum',
    enumValues: CLAUDE_INSTALL_MODES,
    default: 'auto',
    group: 'app',
    section: 'Claude Code plugin migration',
    comment:
      'How this project installs paqad into Claude Code, where auto follows the plugin migration switch, plugin forces the plugin and settings keeps the npm hooks.',
  },

  {
    key: 'rag_enabled',
    env: 'PAQAD_RAG_ENABLED',
    type: 'boolean',
    default: false,
    group: 'rag',
    section: 'Intelligence / RAG',
    comment: 'Loads relevant code and docs into context through search.',
  },
  {
    key: 'rag_embedding_provider',
    env: 'PAQAD_RAG_EMBEDDING_PROVIDER',
    type: 'enum',
    enumValues: EMBEDDING_PROVIDERS,
    default: undefined,
    optional: true,
    group: 'rag',
    section: 'Intelligence / RAG',
    comment:
      'Which embedding service builds the search index, and the local model is used when it is left unset.',
  },
  {
    key: 'rag_embedding_model',
    env: 'PAQAD_RAG_EMBEDDING_MODEL',
    type: 'string',
    default: undefined,
    optional: true,
    group: 'rag',
    section: 'Intelligence / RAG',
    comment: 'The embedding model to use instead of the default model of the provider.',
  },
  {
    key: 'rag_similarity_threshold',
    env: 'PAQAD_RAG_SIMILARITY_THRESHOLD',
    type: 'number',
    default: 0.75,
    group: 'rag',
    section: 'Intelligence / RAG',
    comment:
      'How similar (0 to 1) a piece of code or docs must be to the request before it is loaded.',
  },
  {
    key: 'rag_relief_floor',
    env: 'PAQAD_RAG_RELIEF_FLOOR',
    type: 'number',
    default: 0.35,
    group: 'rag',
    section: 'Intelligence / RAG',
    comment:
      'A lower similarity score used when nothing reaches the main one, and the pieces it lets through are marked low confidence.',
  },
  {
    key: 'rag_top_n',
    env: 'PAQAD_RAG_TOP_N',
    type: 'number',
    default: 20,
    group: 'rag',
    section: 'Intelligence / RAG',
    comment: 'The most pieces of code or docs loaded for one search.',
  },
  {
    key: 'rag_max_file_size',
    env: 'PAQAD_RAG_MAX_FILE_SIZE',
    type: 'number',
    default: 153600,
    group: 'rag',
    section: 'Intelligence / RAG',
    comment: 'Files larger than this many bytes are left out of the search index.',
  },
  {
    key: 'rag_base_branch',
    env: 'PAQAD_RAG_BASE_BRANCH',
    type: 'string',
    default: undefined,
    optional: true,
    group: 'rag',
    section: 'Intelligence / RAG',
    comment:
      'The base branch the search index compares against, found on its own (main, then master) when left unset.',
  },
  {
    key: 'existing_surface_tokens',
    env: 'PAQAD_EXISTING_SURFACE_TOKENS',
    type: 'number',
    default: 1000,
    group: 'rag',
    section: 'Intelligence / RAG',
    comment:
      'The token budget for the list of existing code that planning asks the model to reuse.',
  },

  {
    key: 'model_default',
    env: 'PAQAD_MODEL_DEFAULT',
    type: 'string',
    default: 'gpt-5',
    group: 'models',
    section: 'Research & model routing',
    comment: 'The model used for routine work.',
  },
  {
    key: 'model_reasoning',
    env: 'PAQAD_MODEL_REASONING',
    type: 'string',
    default: 'gpt-5',
    group: 'models',
    section: 'Research & model routing',
    comment: 'The model used for heavy reasoning and planning.',
  },
  {
    key: 'model_fast',
    env: 'PAQAD_MODEL_FAST',
    type: 'string',
    default: 'gpt-5-mini',
    group: 'models',
    section: 'Research & model routing',
    comment: 'The cheap, fast model used for light steps.',
  },

  ...STAGE_SETTING_STAGES.flatMap((stage): BaseConfigSpec[] => [
    {
      key: `stage_effort_${stage}`,
      env: `PAQAD_STAGE_EFFORT_${stage.toUpperCase()}`,
      type: 'enum',
      enumValues: STAGE_EFFORT_LEVELS,
      default: STAGE_EFFORT_DEFAULTS[stage],
      group: 'models',
      section: 'Stage agents',
      comment: stageEffortComment(stage),
    },
    {
      key: `stage_model_${stage}`,
      env: `PAQAD_STAGE_MODEL_${stage.toUpperCase()}`,
      type: 'enum',
      enumValues: STAGE_MODELS,
      default: 'inherit',
      group: 'models',
      section: 'Stage agents',
      comment:
        `The model the ${stage} stage helper runs on, where inherit uses the model of the main ` +
        'session and `paqad-ai stage settings` applies a change.',
    },
  ]),

  {
    key: 'decisions_ask_threshold',
    env: 'PAQAD_DECISIONS_ASK_THRESHOLD',
    type: 'enum',
    enumValues: ASK_THRESHOLDS,
    default: 'strict',
    group: 'policy',
    section: 'Decisions (pause-contract tuning)',
    comment: 'How often paqad stops to ask you instead of making a choice itself.',
  },
  {
    key: 'stages_mode',
    env: 'PAQAD_STAGES_MODE',
    type: 'enum',
    enumValues: STAGE_RULE_MODES,
    default: 'strict',
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment: 'How firmly paqad checks that every feature-development stage was run and recorded.',
  },
  {
    key: 'rule_compliance',
    env: 'PAQAD_RULE_COMPLIANCE',
    type: 'enum',
    enumValues: STAGE_RULE_MODES,
    default: 'warn',
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment: 'How firmly the scripted project rules are enforced on the working tree.',
  },
  {
    key: 'rule_gate_pre_edit',
    env: 'PAQAD_RULE_GATE_PRE_EDIT',
    type: 'enum',
    enumValues: RULE_GATE_PRE_EDIT_MODES,
    default: RULE_GATE_DEFAULTS.pre_edit,
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment:
      'Which rule scripts run before an edit, either only the fast blocking ones or all of them.',
  },
  {
    key: 'rule_gate_concurrency',
    env: 'PAQAD_RULE_GATE_CONCURRENCY',
    type: 'string',
    default: 'auto',
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment:
      'How many rule scripts run at once, from 1 to 8, where auto uses the CPU cores minus one.',
  },
  {
    key: 'rule_gate_budget_ms',
    env: 'PAQAD_RULE_GATE_BUDGET_MS',
    type: 'number',
    default: RULE_GATE_DEFAULTS.budget_ms,
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment:
      'Milliseconds (500 to 9000) the rule check before an edit may take, after which the edit goes ahead and the checks run at turn end.',
  },
  {
    key: 'analytics_strictness',
    env: 'PAQAD_ANALYTICS_STRICTNESS',
    type: 'enum',
    enumValues: STAGE_RULE_MODES,
    default: 'warn',
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment: 'How firmly paqad checks that each analytics event has its tracking plan doc.',
  },
  {
    key: 'duplication_mode',
    env: 'PAQAD_DUPLICATION_MODE',
    type: 'enum',
    enumValues: STAGE_RULE_MODES,
    default: 'warn',
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment:
      'How paqad treats new code that nearly copies existing code, from a warning to a block.',
  },
  {
    key: 'mutation_mode',
    env: 'PAQAD_MUTATION_MODE',
    type: 'enum',
    enumValues: STAGE_RULE_MODES,
    default: 'off',
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment:
      'Mutation testing on changed code, which runs only from the CI or pre-push hook of the project with its own mutation tool.',
  },
  {
    key: 'bundle_completeness',
    env: 'PAQAD_BUNDLE_COMPLETENESS',
    type: 'enum',
    enumValues: STAGE_RULE_MODES,
    default: 'strict',
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment:
      'How firmly paqad checks at the end of a change that its evidence bundle holds every required file.',
  },
  {
    key: 'checks_flaky_under_parallel',
    env: 'PAQAD_CHECKS_FLAKY_UNDER_PARALLEL',
    type: 'enum',
    enumValues: CHECKS_FLAKY_MODES,
    default: 'warn',
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment:
      'What happens to a test that fails in the parallel run but passes alone, and a personal setting may only make it stricter.',
  },
  {
    key: 'visual_evidence_mode',
    env: 'PAQAD_VISUAL_EVIDENCE_MODE',
    type: 'enum',
    enumValues: VISUAL_EVIDENCE_MODES,
    default: 'warn',
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment:
      'How firmly the screenshot check holds a frontend change with missing screenshots, and a personal setting may only make it stricter.',
  },
  {
    key: 'evidence_existence_gate',
    env: 'PAQAD_EVIDENCE_EXISTENCE_GATE',
    type: 'enum',
    enumValues: EVIDENCE_EXISTENCE_MODES,
    default: 'warn',
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment:
      'An older evidence check that runs only while the bundle check is off and never blocks a change.',
  },
  {
    key: 'duplication_similarity_threshold',
    env: 'PAQAD_DUPLICATION_SIMILARITY_THRESHOLD',
    type: 'number',
    default: 0.9,
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment:
      'How similar (0 to 1) new code must be to existing code before the duplication check blocks it.',
  },
  {
    key: 'duplication_min_lines',
    env: 'PAQAD_DUPLICATION_MIN_LINES',
    type: 'number',
    default: 8,
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment:
      'The fewest meaningful lines a new block of code needs before it is checked for duplication.',
  },
  {
    key: 'decision_arm_mode',
    env: 'PAQAD_DECISION_ARM_MODE',
    type: 'enum',
    enumValues: STAGE_RULE_MODES,
    default: 'warn',
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment:
      'How paqad handles a planned new piece of code that looks like existing code, from a report to a pause that waits for your answer.',
  },
  {
    key: 'decision_arm_plan_threshold',
    env: 'PAQAD_DECISION_ARM_PLAN_THRESHOLD',
    type: 'number',
    default: 0.85,
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment:
      'How similar (0 to 1) a planned new name must be to an existing one before paqad asks whether to reuse it.',
  },
  {
    key: 'decision_arm_max_per_change',
    env: 'PAQAD_DECISION_ARM_MAX_PER_CHANGE',
    type: 'number',
    default: 1,
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment: 'The most reuse pauses one change may open, with the rest reported as warnings.',
  },
  {
    key: 'ai_attribution',
    env: 'PAQAD_AI_ATTRIBUTION',
    type: 'enum',
    enumValues: AI_ATTRIBUTION_MODES,
    default: 'strip',
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment:
      'Whether the attribution of the coding agent stays on your commits and pull requests, while the paqad delivery footer is never changed.',
  },
  {
    key: 'stage_isolation_lanes',
    env: 'PAQAD_STAGE_ISOLATION_LANES',
    type: 'string',
    default: 'full',
    group: 'policy',
    section: 'Stage isolation',
    comment:
      'The lanes on which each feature-development stage runs in its own helper agent, and full is always included.',
  },
  {
    key: 'spec_pipeline_enabled',
    env: 'PAQAD_SPEC_PIPELINE_ENABLED',
    type: 'boolean',
    default: SPEC_PIPELINE_DEFAULTS.spec_pipeline_enabled,
    group: 'policy',
    section: 'Spec pipeline',
    comment: 'Writes the spec through the grounded spec pipeline on the graduated and full lanes.',
  },
  {
    key: 'spec_pipeline_clarification',
    env: 'PAQAD_SPEC_PIPELINE_CLARIFICATION',
    type: 'enum',
    enumValues: STAGE_RULE_MODES,
    default: 'warn',
    group: 'policy',
    section: 'Spec pipeline',
    comment:
      'How firmly the spec pipeline asks about an unclear request, from never asking to holding until you answer.',
  },
  {
    key: 'spec_pipeline_final_review',
    env: 'PAQAD_SPEC_PIPELINE_FINAL_REVIEW',
    type: 'enum',
    enumValues: STAGE_RULE_MODES,
    default: 'off',
    group: 'policy',
    section: 'Spec pipeline',
    comment: 'Whether a person must read and approve the spec before it is frozen.',
  },
  {
    key: 'spec_pipeline_token_ceiling',
    env: 'PAQAD_SPEC_PIPELINE_TOKEN_CEILING',
    type: 'number',
    default: 40000,
    group: 'policy',
    section: 'Spec pipeline',
    comment: 'The model tokens one spec pipeline run may use before paqad records a warning.',
  },
  {
    key: 'spec_grounding_budget_ms',
    env: 'PAQAD_SPEC_GROUNDING_BUDGET_MS',
    type: 'number',
    default: 15000,
    group: 'policy',
    section: 'Spec pipeline',
    comment:
      'Milliseconds the spec pipeline gives search to ground a request before it grounds on the docs alone.',
  },
  {
    key: 'spec_pipeline_experts_enabled',
    env: 'PAQAD_SPEC_PIPELINE_EXPERTS_ENABLED',
    type: 'boolean',
    default: SPEC_PIPELINE_DEFAULTS.spec_pipeline_experts_enabled,
    group: 'policy',
    section: 'Spec pipeline',
    comment:
      'Seats the experts a request needs, such as database or security, and adds their notes to the spec.',
  },
  {
    key: 'spec_pipeline_adoption',
    env: 'PAQAD_SPEC_PIPELINE_ADOPTION',
    type: 'enum',
    enumValues: SPEC_PIPELINE_ADOPTION_MODES,
    default: SPEC_PIPELINE_DEFAULTS.spec_pipeline_adoption,
    group: 'policy',
    section: 'Spec pipeline',
    comment:
      'Whether the specification stage refuses a hand-written spec or only records that the pipeline did not write it.',
  },
  {
    key: 'spec_pipeline_experts_lanes',
    env: 'PAQAD_SPEC_PIPELINE_EXPERTS_LANES',
    type: 'string',
    default: 'full',
    group: 'policy',
    section: 'Spec pipeline',
    comment:
      'The lanes on which the standing experts join every spec, and full is always included.',
  },
  {
    key: 'spec_pipeline_standing_experts',
    env: 'PAQAD_SPEC_PIPELINE_STANDING_EXPERTS',
    type: 'string',
    default: 'product-owner,application-architect,user-flow-writer,qa-engineer',
    group: 'policy',
    section: 'Spec pipeline',
    comment: 'The expert roles that join every spec run, whatever the request needs.',
  },
  {
    key: 'skill_orchestrator_enabled',
    env: 'PAQAD_SKILL_ORCHESTRATOR_ENABLED',
    type: 'boolean',
    default: true,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment: 'Turns on the checks and pipeline paqad runs when a skill is written or changed.',
  },
  {
    key: 'authoring_trigger_threshold',
    env: 'PAQAD_AUTHORING_TRIGGER_THRESHOLD',
    type: 'number',
    default: 0.9,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment:
      'The share of test queries (0 to 1) a skill description must handle correctly to pass its trigger test.',
  },
  {
    key: 'authoring_trigger_min_runs',
    env: 'PAQAD_AUTHORING_TRIGGER_MIN_RUNS',
    type: 'number',
    default: 2,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment: 'How many of the three runs of each test query must fire the skill.',
  },
  {
    key: 'skill_eval_min_gain_points',
    env: 'PAQAD_SKILL_EVAL_MIN_GAIN_POINTS',
    type: 'number',
    default: 10,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment: 'How many percentage points a skill must raise the pass rate over running without it.',
  },
  {
    key: 'skill_eval_max_token_multiple',
    env: 'PAQAD_SKILL_EVAL_MAX_TOKEN_MULTIPLE',
    type: 'number',
    default: 2,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment: 'The most tokens a skill run may use, as a multiple of a run without the skill.',
  },
  {
    key: 'authoring_runs_per_arm',
    env: 'PAQAD_AUTHORING_RUNS_PER_ARM',
    type: 'number',
    default: 3,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment: 'How many times each eval case runs with the skill and without it.',
  },
  {
    key: 'authoring_max_iterations',
    env: 'PAQAD_AUTHORING_MAX_ITERATIONS',
    type: 'number',
    default: 3,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment: 'The most revision rounds an eval loop runs before it stops.',
  },
  {
    key: 'authoring_fact_max_age_days',
    env: 'PAQAD_AUTHORING_FACT_MAX_AGE_DAYS',
    type: 'number',
    default: 60,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment:
      'Days a checked outside fact in the sources of a skill stays fresh before release asks for a recheck.',
  },
  {
    key: 'authoring_collision_jaccard',
    env: 'PAQAD_AUTHORING_COLLISION_JACCARD',
    type: 'number',
    default: 0.4,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment:
      'How much word overlap (0 to 1) a new skill may have with an installed one before it counts as a clash.',
  },
  {
    key: 'authoring_description_budget_chars',
    env: 'PAQAD_AUTHORING_DESCRIPTION_BUDGET_CHARS',
    type: 'number',
    default: 8000,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment:
      'The total characters of all installed skill descriptions before release warns that some may be dropped.',
  },
  {
    key: 'skill_body_max_tokens',
    env: 'PAQAD_SKILL_BODY_MAX_TOKENS',
    type: 'number',
    default: 5000,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment: 'The most tokens the body of a skill file may hold.',
  },
  {
    key: 'authoring_tool_result_max_tokens',
    env: 'PAQAD_AUTHORING_TOOL_RESULT_MAX_TOKENS',
    type: 'number',
    default: 10000,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment: 'A tool result larger than this many tokens is flagged as too large in an eval run.',
  },
  {
    key: 'authoring_cache_hit_min',
    env: 'PAQAD_AUTHORING_CACHE_HIT_MIN',
    type: 'number',
    default: 0.7,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment: 'The share of cache hits (0 to 1) below which an eval run is recorded as slow.',
  },
  {
    key: 'authoring_regression_tolerance',
    env: 'PAQAD_AUTHORING_REGRESSION_TOLERANCE',
    type: 'number',
    default: 0.2,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment:
      'How far (0 to 1) the pass rate of a changed skill may fall below the old version before it fails.',
  },
  {
    key: 'authoring_dark_window_days',
    env: 'PAQAD_AUTHORING_DARK_WINDOW_DAYS',
    type: 'number',
    default: 30,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment: 'Days without a firing before a skill is reported as unused.',
  },
  {
    key: 'authoring_batch_mode',
    env: 'PAQAD_AUTHORING_BATCH_MODE',
    type: 'enum',
    enumValues: AUTHORING_BATCH_MODES,
    default: 'auto',
    group: 'policy',
    section: AUTHORING_SECTION,
    comment: 'Whether trigger test queries are sent as one batch when the host offers it.',
  },
  {
    key: 'authoring_run_max_cost_usd',
    env: 'PAQAD_AUTHORING_RUN_MAX_COST_USD',
    type: 'number',
    default: 5,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment:
      'The most US dollars one eval or trigger run may spend before it stops and counts as failed.',
  },
  {
    key: 'authoring_otel_endpoint',
    env: 'PAQAD_AUTHORING_OTEL_ENDPOINT',
    type: 'string',
    default: '',
    group: 'policy',
    section: AUTHORING_SECTION,
    comment:
      'An OpenTelemetry address to also read usage numbers from, where empty reads them from the host only and paqad never sends transcripts there.',
  },
  {
    key: 'agent_orchestrator_enabled',
    env: 'PAQAD_AGENT_ORCHESTRATOR_ENABLED',
    type: 'boolean',
    default: true,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment:
      'Turns on the checks and pipeline paqad runs when a helper agent is written or changed.',
  },
  {
    key: 'agent_pass_k_threshold',
    env: 'PAQAD_AGENT_PASS_K_THRESHOLD',
    type: 'number',
    default: 0.9,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment: 'The score (0 to 1) an agent must reach when each of its eval cases runs three times.',
  },
  {
    key: 'agent_stage_pass_k_threshold',
    env: 'PAQAD_AGENT_STAGE_PASS_K_THRESHOLD',
    type: 'number',
    default: 0.95,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment:
      'The score (0 to 1) an unattended stage agent must reach when each of its eval cases runs three times.',
  },
  {
    key: 'agent_delegation_threshold',
    env: 'PAQAD_AGENT_DELEGATION_THRESHOLD',
    type: 'number',
    default: 0.9,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment:
      'The share of test requests (0 to 1) an agent description must route to the agent correctly.',
  },
  {
    key: 'agent_description_max_tokens',
    env: 'PAQAD_AGENT_DESCRIPTION_MAX_TOKENS',
    type: 'number',
    default: 300,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment: 'The most tokens an agent description may hold.',
  },
  {
    key: 'agent_report_max_tokens',
    env: 'PAQAD_AGENT_REPORT_MAX_TOKENS',
    type: 'number',
    default: 2000,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment: 'The most tokens an agent report may hold when the agent names no smaller limit.',
  },
  {
    key: 'agent_prompt_max_tokens',
    env: 'PAQAD_AGENT_PROMPT_MAX_TOKENS',
    type: 'number',
    default: 3000,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment: 'The most tokens the instructions of an agent may hold.',
  },
  {
    key: 'agent_max_tools',
    env: 'PAQAD_AGENT_MAX_TOOLS',
    type: 'number',
    default: 10,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment: 'The most tools an agent may list before it needs an approval.',
  },
  {
    key: 'agent_max_cost_multiple',
    env: 'PAQAD_AGENT_MAX_COST_MULTIPLE',
    type: 'number',
    default: 4,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment:
      'The most an agent run may cost, as a multiple of doing the work in the main session, unless it saves time by running in parallel.',
  },
  {
    key: 'agent_catalog_description_max_tokens',
    env: 'PAQAD_AGENT_CATALOG_DESCRIPTION_MAX_TOKENS',
    type: 'number',
    default: 15000,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment: 'The most tokens all installed agent descriptions may hold together.',
  },
  {
    key: 'agent_memory_max_lines',
    env: 'PAQAD_AGENT_MEMORY_MAX_LINES',
    type: 'number',
    default: 200,
    group: 'policy',
    section: AUTHORING_SECTION,
    comment: 'The most lines the memory file of an agent may hold.',
  },
] as const;

export const FRAMEWORK_CONFIG_SPECS: readonly FrameworkConfigSpec[] = BASE_CONFIG_SPECS.map(
  (spec) => ({ ...spec, ...teamConfigHome(spec.key) }),
);

function stageEffortComment(stage: string): string {
  const base =
    `How hard the ${stage} stage helper thinks, where inherit uses the effort of the main ` +
    'session and `paqad-ai stage settings` applies a change';
  return stage === 'review' ? `${base}, and a lighter review catches less.` : `${base}.`;
}

const SPEC_BY_KEY = new Map<string, FrameworkConfigSpec>(
  FRAMEWORK_CONFIG_SPECS.map((spec) => [spec.key, spec]),
);

export const KNOWN_CONFIG_KEYS: ReadonlySet<string> = new Set(
  FRAMEWORK_CONFIG_SPECS.map((spec) => spec.key),
);

const DEFAULT_EFFICIENCY_TUNING = {
  context_hit_rate_target: 0.7,
  skill_caching: true,
  differential_refresh: true,
  mcp_first: true,
} as const;

export interface ResolvedFrameworkConfig {
  paqad: { enabled: boolean };
  enterprise: EnterpriseConfig;
  intelligence: IntelligenceConfig;
  features: ProjectFeatureFlags;
  model_routing: ModelRoutingConfig;
  decisions: DecisionProfileConfig;
  efficiency: EfficiencyConfig;
}

export function parseDotConfig(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) {
      continue;
    }
    let key = line.slice(0, eq).trim();
    if (key.startsWith('export ')) {
      key = key.slice('export '.length).trim();
    }
    if (key === '') {
      continue;
    }
    out.set(key, stripValue(line.slice(eq + 1)));
  }
  return out;
}

function stripValue(raw: string): string {
  const v = raw.trim();
  if (
    v.length >= 2 &&
    ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
  ) {
    return v.slice(1, -1);
  }
  const inlineComment = v.search(/\s#/u);
  return inlineComment === -1 ? v : v.slice(0, inlineComment).trim();
}

export function readRawDotConfig(projectRoot: string): Map<string, string> {
  try {
    return parseDotConfig(readFileSync(join(projectRoot, PATHS.PROJECT_CONFIG), 'utf8'));
  } catch {
    return new Map();
  }
}

export function readDotConfig(projectRoot: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of readRawDotConfig(projectRoot)) {
    out.set(key, personalValue(SPEC_BY_KEY.get(key), value));
  }
  return out;
}

export function envConfigValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const spec = SPEC_BY_KEY.get(key);
  const raw = spec === undefined ? undefined : env[spec.env];
  return raw === undefined ? undefined : personalValue(spec, raw);
}

export { listConfigsFiles };

export interface ConfigsCollision {
  key: string;
  files: string[];
}

export function readConfigsDir(projectRoot: string): TeamConfigRead {
  return readTeamConfig(projectRoot);
}

export function layeredConfigMap(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Map<string, string> {
  const merged = new Map<string, string>();
  for (const [key, value] of readTeamConfig(projectRoot).merged) {
    merged.set(key, value);
  }
  for (const [key, value] of readDotConfig(projectRoot)) {
    merged.set(key, value);
  }
  for (const spec of FRAMEWORK_CONFIG_SPECS) {
    const raw = env[spec.env];
    if (typeof raw === 'string' && raw.trim() !== '') {
      merged.set(spec.key, personalValue(spec, raw));
    }
  }
  return merged;
}

export function resolveNumericConfig(
  projectRoot: string,
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  valid: (value: number) => boolean,
): number {
  const raw = layeredConfigMap(projectRoot, env).get(key);
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) && valid(parsed) ? parsed : fallback;
}

export interface RuleGateConfig {
  preEdit: RuleGatePreEditMode;
  concurrency: number;
  budgetMs: number;
}

export function autoRuleGateConcurrency(cores: number = availableParallelism()): number {
  return Math.max(1, Math.min(RULE_GATE_DEFAULTS.max_concurrency, cores - 1));
}

function positiveNumber(raw: string | undefined): number | undefined {
  const parsed = raw === undefined || raw.trim() === '' ? NaN : Number(raw.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function resolveRuleGateConfig(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  cores: number = availableParallelism(),
): RuleGateConfig {
  const raw = layeredConfigMap(projectRoot, env);
  const budget = positiveNumber(raw.get('rule_gate_budget_ms'));
  const concurrency = positiveNumber(raw.get('rule_gate_concurrency'));
  const wholeConcurrency = concurrency === undefined ? 0 : Math.floor(concurrency);
  return {
    preEdit: asEnum(
      raw.get('rule_gate_pre_edit')?.toLowerCase(),
      RULE_GATE_PRE_EDIT_MODES,
      RULE_GATE_DEFAULTS.pre_edit,
    ),
    concurrency:
      wholeConcurrency >= 1
        ? Math.min(RULE_GATE_DEFAULTS.max_concurrency, wholeConcurrency)
        : autoRuleGateConcurrency(cores),
    budgetMs:
      budget === undefined
        ? RULE_GATE_DEFAULTS.budget_ms
        : Math.min(
            RULE_GATE_DEFAULTS.max_budget_ms,
            Math.max(RULE_GATE_DEFAULTS.min_budget_ms, budget),
          ),
  };
}

export function configSaysPaqadDisabled(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = layeredConfigMap(projectRoot, env).get('paqad_enable');
  return raw !== undefined && FALSY.has(raw.trim().toLowerCase());
}

export function resolveTeamBootstrapEnabled(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = layeredConfigMap(projectRoot, env).get('team_bootstrap_enabled');
  return raw === undefined || !FALSY.has(raw.trim().toLowerCase());
}

export function teamSetsInstallModeSettings(projectRoot: string): boolean {
  const raw = readConfigsDir(projectRoot).merged.get('claude_install_mode');
  return raw?.trim().toLowerCase() === 'settings';
}

export interface PluginMigrationConfig {
  migration: (typeof PLUGIN_MIGRATION_MODES)[number];
  install_mode: (typeof CLAUDE_INSTALL_MODES)[number];
}

export function resolvePluginMigrationConfig(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): PluginMigrationConfig {
  const raw = layeredConfigMap(projectRoot, env);
  return {
    migration: asEnum(
      raw.get('plugin_migration'),
      PLUGIN_MIGRATION_MODES,
      defOf('plugin_migration') as (typeof PLUGIN_MIGRATION_MODES)[number],
    ),
    install_mode: asEnum(
      raw.get('claude_install_mode'),
      CLAUDE_INSTALL_MODES,
      defOf('claude_install_mode') as (typeof CLAUDE_INSTALL_MODES)[number],
    ),
  };
}

export interface StageAgentSetting {
  effort: StageEffort;
  model: StageModel;
}

export function resolveStageAgentSettings(
  projectRoot?: string,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, StageAgentSetting> {
  const raw =
    projectRoot === undefined ? new Map<string, string>() : layeredConfigMap(projectRoot, env);
  const settings: Record<string, StageAgentSetting> = {};
  for (const stage of STAGE_SETTING_STAGES) {
    settings[stage] = {
      effort: asEnum(
        raw.get(`stage_effort_${stage}`),
        STAGE_EFFORT_LEVELS,
        STAGE_EFFORT_DEFAULTS[stage]!,
      ),
      model: asEnum(raw.get(`stage_model_${stage}`), STAGE_MODELS, 'inherit'),
    };
  }
  return settings;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function setConfigValue(projectRoot: string, key: string, value: string): string {
  const path = join(projectRoot, PATHS.PROJECT_CONFIG);
  let existing = '';
  try {
    existing = readFileSync(path, 'utf8');
  } catch {}
  const lines = existing.replace(/\n+$/u, '').split(/\r?\n/);
  const assignRe = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=`, 'u');
  let replaced = false;
  const next = lines.map((line) => {
    if (!replaced && !line.trimStart().startsWith('#') && assignRe.test(line)) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!replaced) {
    if (next.length === 1 && next[0] === '') {
      next[0] = `${key}=${value}`;
    } else {
      next.push(`${key}=${value}`);
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${next.join('\n')}\n`, 'utf8');
  return path;
}

function asBool(raw: string | undefined, def: boolean): boolean {
  if (raw === undefined) {
    return def;
  }
  const t = raw.trim().toLowerCase();
  if (TRUTHY.has(t)) {
    return true;
  }
  if (FALSY.has(t)) {
    return false;
  }
  return def;
}

function asNum(raw: string | undefined, def: number): number {
  if (raw === undefined || raw.trim() === '') {
    return def;
  }
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : def;
}

function asStr(raw: string | undefined, def: string): string {
  if (raw === undefined || raw.trim() === '') {
    return def;
  }
  return raw.trim();
}

function asEnum<T extends string>(raw: string | undefined, allowed: readonly T[], def: T): T {
  if (raw === undefined) {
    return def;
  }
  const t = raw.trim();
  return (allowed as readonly string[]).includes(t) ? (t as T) : def;
}

export interface SpecPipelineSwitches {
  enabled: boolean;
  experts_enabled: boolean;
  adoption: SpecPipelineAdoptionMode;
  experts_lanes: Lane[];
}

export function resolveSpecPipelineSwitches(
  map: ReadonlyMap<string, string>,
): SpecPipelineSwitches {
  return {
    enabled: asBool(map.get('spec_pipeline_enabled'), SPEC_PIPELINE_DEFAULTS.spec_pipeline_enabled),
    experts_enabled: asBool(
      map.get('spec_pipeline_experts_enabled'),
      SPEC_PIPELINE_DEFAULTS.spec_pipeline_experts_enabled,
    ),
    adoption: asEnum(
      map.get('spec_pipeline_adoption')?.toLowerCase(),
      SPEC_PIPELINE_ADOPTION_MODES,
      SPEC_PIPELINE_DEFAULTS.spec_pipeline_adoption,
    ),
    experts_lanes: resolveLaneList(map.get('spec_pipeline_experts_lanes'), ['full']),
  };
}

export function resolveLaneList(raw: string | undefined, fallback: readonly Lane[]): Lane[] {
  const known = (raw ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part): part is Lane => (LANES as readonly string[]).includes(part));
  const lanes = [...new Set(known.length > 0 ? known : fallback)];
  return lanes.includes('full') ? lanes : [...lanes, 'full'];
}

export function resolveStageIsolationLanes(map: ReadonlyMap<string, string>): Lane[] {
  return resolveLaneList(map.get('stage_isolation_lanes'), ['full']);
}

function asOptEnum<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
): T | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const t = raw.trim();
  return (allowed as readonly string[]).includes(t) ? (t as T) : undefined;
}

function defOf(key: string): boolean | number | string | undefined {
  return SPEC_BY_KEY.get(key)?.default;
}

export function resolveFrameworkConfigFromMap(raw: Map<string, string>): ResolvedFrameworkConfig {
  const rb = (key: string): boolean => asBool(raw.get(key), defOf(key) as boolean);
  const rn = (key: string): number => asNum(raw.get(key), defOf(key) as number);
  const rs = (key: string): string => asStr(raw.get(key), defOf(key) as string);

  const provider = asOptEnum(raw.get('rag_embedding_provider'), EMBEDDING_PROVIDERS);
  const embeddingModel = raw.get('rag_embedding_model')?.trim() || undefined;

  const intelligence = normalizeIntelligenceConfig({
    rag_enabled: rb('rag_enabled'),
    embedding_provider: provider,
    embedding_model: embeddingModel,
    rag_similarity_threshold: rn('rag_similarity_threshold'),
    rag_relief_floor: rn('rag_relief_floor'),
    rag_top_n: rn('rag_top_n'),
    rag_max_file_size: rn('rag_max_file_size'),
    rag_base_branch: raw.get('rag_base_branch')?.trim() || undefined,
    existing_surface_tokens: rn('existing_surface_tokens'),
  });

  return {
    paqad: { enabled: rb('paqad_enable') },
    enterprise: {
      enabled: rb('enterprise'),
      evidence_ledger: rb('enterprise_evidence_ledger'),
      ai_bom: rb('enterprise_ai_bom'),
      compliance_citations: rb('enterprise_compliance_citations'),
    },
    intelligence,
    features: {
      spec_only_mode: rb('spec_only_mode'),
      market_research: rb('market_research'),
      design_research: rb('design_research'),
      team_agents: rb('team_agents'),
      analytics_instrumentation: rb('analytics_instrumentation'),
      site_map: rb('site_map'),
      lean_rules: rb('lean_rules'),
      feature_report: rb('feature_report'),
      metrics_enabled: rb('metrics_enabled'),
      visual_evidence: rb('visual_evidence'),
      checks_parallel: rb('checks_parallel'),
      checks_max_processes: rn('checks_max_processes'),
    },
    model_routing: {
      default_model: rs('model_default'),
      reasoning_model: rs('model_reasoning'),
      fast_model: rs('model_fast'),
    },
    decisions: {
      ask_threshold: asEnum(
        raw.get('decisions_ask_threshold'),
        ASK_THRESHOLDS,
        defOf('decisions_ask_threshold') as DecisionProfileConfig['ask_threshold'] & string,
      ),
    },
    efficiency: {
      ...DEFAULT_EFFICIENCY_TUNING,
      auto_update: rb('auto_update'),
      minimum_version: rs('minimum_version'),
      version_check_interval_hours: rn('version_check_interval_hours'),
    },
  };
}

export function resolveFrameworkConfig(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedFrameworkConfig {
  return resolveFrameworkConfigFromMap(layeredConfigMap(projectRoot, env));
}

export const DEFAULT_FRAMEWORK_CONFIG: ResolvedFrameworkConfig = resolveFrameworkConfigFromMap(
  new Map(),
);

const DECISION_CONFIG_KEYS = [
  'ask_threshold',
  'max_screens_per_task',
  'idle_timeout_minutes',
] as const;

const REMOVED_PROFILE_SECTIONS = ['strictness', 'escalation', 'research'] as const;

export const FRAMEWORK_CONFIG_SECTIONS = [
  'paqad',
  'enterprise',
  'intelligence',
  ...REMOVED_PROFILE_SECTIONS,
  'features',
  'model_routing',
  'efficiency',
] as const;

function withoutRemovedSections(base: ProjectProfile): ProjectProfile {
  const clone: Record<string, unknown> = { ...base };
  for (const section of REMOVED_PROFILE_SECTIONS) delete clone[section];
  return clone as unknown as ProjectProfile;
}

export function applyFrameworkConfigToProfile(
  base: ProjectProfile,
  resolved: ResolvedFrameworkConfig = DEFAULT_FRAMEWORK_CONFIG,
): ProjectProfile {
  return {
    ...withoutRemovedSections(base),
    paqad: resolved.paqad,
    enterprise: resolved.enterprise,
    intelligence: resolved.intelligence,
    features: resolved.features,
    model_routing: resolved.model_routing,
    efficiency: resolved.efficiency,
    custom: {
      classification_dimensions: base.custom?.classification_dimensions ?? [],
      verification_plugins: base.custom?.verification_plugins ?? [],
      escalation_rules: base.custom?.escalation_rules ?? [],
      decisions: { ...base.custom?.decisions, ...resolved.decisions },
      ...(base.custom?.flaky ? { flaky: base.custom.flaky } : {}),
    },
  };
}

export function stripFrameworkConfigFromProfile<T extends Partial<ProjectProfile>>(
  profile: T,
): Partial<ProjectProfile> {
  const clone: Record<string, unknown> = { ...profile };
  for (const section of FRAMEWORK_CONFIG_SECTIONS) {
    delete clone[section];
  }
  const custom = (profile as ProjectProfile).custom;
  if (custom) {
    const { decisions, ...customRest } = custom;
    if (decisions) {
      const kept: Record<string, unknown> = { ...decisions };
      for (const key of DECISION_CONFIG_KEYS) {
        delete kept[key];
      }
      if (Object.keys(kept).length > 0) {
        (customRest as Record<string, unknown>).decisions = kept;
      }
    }
    clone.custom = customRest;
  }
  return clone as Partial<ProjectProfile>;
}

export function generateConfigsReadme(): string {
  const fileLines = TEAM_CONFIG_FILES.map(
    (file) => `- \`${file}\` — ${TEAM_CONFIG_FILE_DESCRIPTIONS[file]}`,
  );
  const settingSections = [...TEAM_CONFIG_FILES, GIT_WORKFLOW_COMMITS_FILE].flatMap((file) => {
    const rows = FRAMEWORK_CONFIG_SPECS.filter((spec) => spec.file === file);
    return [
      `### \`${file}\``,
      '',
      '| Path | Default | Allowed values | Description | `.paqad/.config` name | Env var |',
      '|---|---|---|---|---|---|',
      ...rows.map((spec) => readmeRow(spec)),
      '',
    ];
  });
  return [
    '# paqad team configuration (`.paqad/configs/`)',
    '',
    'Tracked, team-shared settings, in YAML files that list the settings they could hold',
    "when they were written, commented out with paqad's default and a note. A setting left",
    "commented out uses paqad's default. Settings added later aren't listed in them.",
    '',
    ...fileLines,
    '- `git-workflow/` — the team rules for tickets, branches, commits, pull requests and',
    '  enforcement (see below).',
    '',
    'Run `paqad-ai config show` to see every setting, its value and where it comes from',
    '(`--changed` lists only the ones that differ from the default).',
    '',
    '## How to use',
    '',
    '- Remove the `#` in front of a setting (and in front of its group name) to change it;',
    '  put the `#` back to go back to the default.',
    '- Gates use one vocabulary: `off | warn | block`.',
    '- `paqad-ai update` regenerates this README when the settings list changes. It rewrites',
    '  a team file only for a migration, a retired value or setting, or a stale workflow',
    '  entry, and it says so. Find new settings in `../.config.example`.',
    '',
    '## Personal overrides',
    '',
    'A teammate can override a setting for themselves in the git-ignored `../.config`',
    '(`<name>=<value>`, using the `.paqad/.config` name below), and a `PAQAD_*` env var',
    'overrides everything. Both accept the values below as well as the older values.',
    '`../.config.example` lists every name with its YAML home.',
    '',
    '## Every setting',
    '',
    ...settingSections,
    '## git-workflow/',
    '',
    "`git-workflow/` holds this team's rules for tickets, branches, commits, pull requests",
    "and how strictly they're checked, in six YAML files: `tickets.yaml`, `branches.yaml`,",
    '`commits.yaml`, `pull-requests.yaml`, `enforcement.yaml` and `design-sign-off.yaml`.',
    '',
    "- No personal override applies: `../.config` and `PAQAD_*` env vars don't change them.",
    '  The one exception is `ai_attribution` in `commits.yaml`, which keeps its personal',
    '  and env override.',
    '- `paqad-ai update` adds no settings to these files, and changes one only for a',
    '  migration.',
    "- The commit-msg and pre-push hooks check people's commits and pushes;",
    '  `git commit --no-verify` skips them.',
    '- Changes go through the `git-workflow` skill. Ask your agent, for example "make hotfix',
    '  branches start from main".',
    '',
  ].join('\n');
}

function yamlText(value: unknown): string {
  if (value === undefined) return '(unset)';
  if (Array.isArray(value)) return `[${value.join(', ')}]`;
  return String(value);
}

function readmeRow(spec: FrameworkConfigSpec): string {
  const allowed = spec.yaml?.list
    ? 'a list'
    : spec.yaml?.zeroIsAuto
      ? 'a number or auto'
      : (yamlEnumOf(spec)?.join(' \\| ') ??
        (spec.type === 'boolean'
          ? 'true \\| false'
          : spec.type === 'number'
            ? 'a number'
            : 'text'));
  const description = spec.comment.replace(/\\/gu, '\\\\').replace(/\|/gu, '\\|');
  return `| \`${spec.path.join('.')}\` | \`${yamlText(yamlDefault(spec))}\` | ${allowed} | ${description} | \`${spec.key}\` | \`${spec.env}\` |`;
}

export function writeConfigsReadme(projectRoot: string): string {
  const path = join(projectRoot, PATHS.PROJECT_CONFIGS_README);
  if (checkoutIsNewer(projectRoot)) return path;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, generateConfigsReadme(), 'utf8');
  return path;
}

export const CATALOG_VERSION = 2;
const CATALOG_VERSION_STAMP = '# catalog_version: ';

export function generateConfigExample(): string {
  const lines: string[] = [
    '# paqad framework configuration — catalog of every knob (.paqad/.config.example)',
    `${CATALOG_VERSION_STAMP}${CATALOG_VERSION}`,
    '#',
    '# The reference for personal overrides: every setting, with its default, a one-line',
    '# explanation and its PAQAD_* env equivalent, grouped by its team YAML file. This',
    '# file is NEVER read at runtime. To override a setting for yourself, copy its line',
    '# into your git-ignored .config, uncomment it and set a value. To change it for the',
    '# team, set it at the YAML file and path named above it (see configs/README.md).',
    '#',
    '# Precedence, highest first: PAQAD_* env var > .config (personal) > configs/*.yaml',
    '# (team) > code default. With nothing set anywhere, every setting is at the',
    '# default shown below — identical to a fresh install.',
    '',
  ];

  for (const file of [...TEAM_CONFIG_FILES, GIT_WORKFLOW_COMMITS_FILE]) {
    lines.push(`# ── ${file} ${'─'.repeat(Math.max(0, 56 - file.length))}`);
    for (const spec of FRAMEWORK_CONFIG_SPECS.filter((row) => row.file === file)) {
      lines.push(`# ${file}: ${spec.path.join('.')}`);
      lines.push(`# ${spec.comment} (env: ${spec.env})`);
      lines.push(`# ${spec.key}=${renderDefault(spec)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function renderDefault(spec: FrameworkConfigSpec): string {
  return spec.default === undefined ? '' : String(spec.default);
}

export function writeConfigExample(projectRoot: string): string {
  const path = join(projectRoot, PATHS.PROJECT_CONFIG_EXAMPLE);
  if (checkoutIsNewer(projectRoot)) return path;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, generateConfigExample(), 'utf8');
  return path;
}

const CONFIG_EXAMPLE_STAMP = '# generated by paqad-ai ';
const CATALOG_STAMP_LINE = /^# catalog_version:[ \t]*(\S*)[ \t]*\r?$/mu;

export function checkoutIsNewer(projectRoot: string, version: string = __PKG_VERSION__): boolean {
  let example: string;
  try {
    example = readFileSync(join(projectRoot, PATHS.PROJECT_CONFIG_EXAMPLE), 'utf8');
  } catch {
    return false;
  }
  const catalog = CATALOG_STAMP_LINE.exec(example);
  if (catalog !== null) return isHigherStamp(catalog[1], CATALOG_VERSION);
  const stamp = example.split('\n').find((line) => line.startsWith(CONFIG_EXAMPLE_STAMP));
  if (stamp === undefined) return false;
  const stamped = stamp.slice(CONFIG_EXAMPLE_STAMP.length).trim();
  return !versionAtLeast(version, stamped);
}

export interface ReconciledConfigFile {
  path: string;
  removed: string[];
}

export function pruneUnknownKeysFromText(
  text: string,
  known: ReadonlySet<string> = KNOWN_CONFIG_KEYS,
): { text: string; removed: string[] } {
  const removed: string[] = [];
  const kept = text.split('\n').filter((line) => {
    const trimmed = line.trimStart();
    if (trimmed === '' || trimmed.startsWith('#')) {
      return true;
    }
    const m = trimmed.match(/^(?:export\s+)?([^=\s]+)\s*=/u);
    if (!m) {
      return true;
    }
    if (known.has(m[1])) {
      return true;
    }
    removed.push(m[1]);
    return false;
  });
  return { text: kept.join('\n'), removed };
}

export function reconcileConfigOverrides(projectRoot: string): ReconciledConfigFile[] {
  const report: ReconciledConfigFile[] = [];
  if (checkoutIsNewer(projectRoot)) return report;
  const localConfig = join(projectRoot, PATHS.PROJECT_CONFIG);
  const targets = [localConfig, ...listConfigsFiles(projectRoot)];
  for (const file of targets) {
    let original: string;
    try {
      original = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const { text, removed } = pruneUnknownKeysFromText(original);
    if (removed.length === 0) {
      continue;
    }
    writeFileSync(file, text, 'utf8');
    report.push({ path: file.slice(projectRoot.length + 1), removed });
  }
  return report;
}

export function detectFlippedFrameworkValues(projectRoot: string): string[] {
  let raw: string;
  try {
    raw = readFileSync(join(projectRoot, PATHS.PROJECT_PROFILE), 'utf8');
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') {
    return [];
  }
  return [...frameworkOverridesToFlat(parsed as Partial<ProjectProfile>)].map(
    ([key, value]) => `${key}=${value}`,
  );
}

export function frameworkOverridesToFlat(overrides: Partial<ProjectProfile>): Map<string, string> {
  const out = new Map<string, string>();
  const d = DEFAULT_FRAMEWORK_CONFIG;
  const put = (key: string, value: unknown, def: unknown): void => {
    if (value !== undefined && String(value) !== String(def)) {
      out.set(key, String(value));
    }
  };

  if (overrides.paqad) {
    put('paqad_enable', overrides.paqad.enabled, d.paqad.enabled);
  }
  if (overrides.enterprise) {
    put('enterprise', overrides.enterprise.enabled, d.enterprise.enabled);
    put(
      'enterprise_evidence_ledger',
      overrides.enterprise.evidence_ledger,
      d.enterprise.evidence_ledger,
    );
    put('enterprise_ai_bom', overrides.enterprise.ai_bom, d.enterprise.ai_bom);
    put(
      'enterprise_compliance_citations',
      overrides.enterprise.compliance_citations,
      d.enterprise.compliance_citations,
    );
  }
  if (overrides.intelligence) {
    const i = overrides.intelligence;
    put('rag_enabled', i.rag_enabled, d.intelligence.rag_enabled);
    put('rag_embedding_provider', i.embedding_provider, d.intelligence.embedding_provider);
    put('rag_embedding_model', i.embedding_model, d.intelligence.embedding_model);
    put(
      'rag_similarity_threshold',
      i.rag_similarity_threshold,
      d.intelligence.rag_similarity_threshold,
    );
    put('rag_relief_floor', i.rag_relief_floor, d.intelligence.rag_relief_floor);
    put('rag_top_n', i.rag_top_n, d.intelligence.rag_top_n);
    put('rag_max_file_size', i.rag_max_file_size, d.intelligence.rag_max_file_size);
    put('rag_base_branch', i.rag_base_branch, d.intelligence.rag_base_branch);
    put(
      'existing_surface_tokens',
      i.existing_surface_tokens,
      d.intelligence.existing_surface_tokens,
    );
  }
  if (overrides.features) {
    const f = overrides.features;
    put('spec_only_mode', f.spec_only_mode, d.features.spec_only_mode);
    put('market_research', f.market_research, d.features.market_research);
    put('design_research', f.design_research, d.features.design_research);
    put('team_agents', f.team_agents, d.features.team_agents);
    put(
      'analytics_instrumentation',
      f.analytics_instrumentation,
      d.features.analytics_instrumentation,
    );
    put('lean_rules', f.lean_rules, d.features.lean_rules);
    put('feature_report', f.feature_report, d.features.feature_report);
    put('metrics_enabled', f.metrics_enabled, d.features.metrics_enabled);
    put('checks_parallel', f.checks_parallel, d.features.checks_parallel);
    put('checks_max_processes', f.checks_max_processes, d.features.checks_max_processes);
  }
  if (overrides.model_routing) {
    const m = overrides.model_routing;
    put('model_default', m.default_model, d.model_routing.default_model);
    put('model_reasoning', m.reasoning_model, d.model_routing.reasoning_model);
    put('model_fast', m.fast_model, d.model_routing.fast_model);
  }
  if (overrides.custom?.decisions) {
    const dec = overrides.custom.decisions;
    put('decisions_ask_threshold', dec.ask_threshold, d.decisions.ask_threshold);
  }
  if (overrides.efficiency) {
    const ef = overrides.efficiency;
    put('auto_update', ef.auto_update, d.efficiency.auto_update);
    put('minimum_version', ef.minimum_version, d.efficiency.minimum_version);
    put(
      'version_check_interval_hours',
      ef.version_check_interval_hours,
      d.efficiency.version_check_interval_hours,
    );
  }
  return out;
}

export function writeFrameworkOverridesToConfig(
  projectRoot: string,
  overrides: Partial<ProjectProfile>,
): string[] {
  const written: string[] = [];
  for (const [key, value] of frameworkOverridesToFlat(overrides)) {
    setConfigValue(projectRoot, key, value);
    written.push(key);
  }
  return written;
}

export function removeConfigValue(projectRoot: string, key: string): void {
  const path = join(projectRoot, PATHS.PROJECT_CONFIG);
  let existing: string;
  try {
    existing = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  const assignRe = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=`, 'u');
  const kept = existing
    .split(/\r?\n/)
    .filter((line) => line.trimStart().startsWith('#') || !assignRe.test(line));
  writeFileSync(path, kept.join('\n'), 'utf8');
}

export const CONFIG_KEY_SECTIONS: ReadonlyArray<{
  present: (p: Partial<ProjectProfile>) => boolean;
  keys: readonly string[];
}> = [
  { present: (p) => p.paqad !== undefined, keys: ['paqad_enable'] },
  {
    present: (p) => p.enterprise !== undefined,
    keys: [
      'enterprise',
      'enterprise_evidence_ledger',
      'enterprise_ai_bom',
      'enterprise_compliance_citations',
    ],
  },
  {
    present: (p) => p.intelligence !== undefined,
    keys: [
      'rag_enabled',
      'rag_embedding_provider',
      'rag_embedding_model',
      'rag_similarity_threshold',
      'rag_relief_floor',
      'rag_top_n',
      'rag_max_file_size',
      'rag_base_branch',
      'existing_surface_tokens',
    ],
  },
  {
    present: (p) => p.features !== undefined,
    keys: [
      'spec_only_mode',
      'market_research',
      'design_research',
      'team_agents',
      'analytics_instrumentation',
      'site_map',
      'rules_discovery_private_packages',
      'lean_rules',
      'feature_report',
      'metrics_enabled',
      'visual_evidence',
      'checks_parallel',
      'checks_max_processes',
    ],
  },
  {
    present: (p) => p.model_routing !== undefined,
    keys: ['model_default', 'model_reasoning', 'model_fast'],
  },
  {
    present: (p) => p.custom?.decisions !== undefined,
    keys: ['decisions_ask_threshold'],
  },
  {
    present: (p) => p.efficiency !== undefined,
    keys: ['auto_update', 'minimum_version', 'version_check_interval_hours'],
  },
  {
    present: () => false,
    keys: [
      'stages_mode',
      'rule_compliance',
      'rule_gate_pre_edit',
      'rule_gate_concurrency',
      'rule_gate_budget_ms',
      'analytics_strictness',
      'duplication_mode',
      'mutation_mode',
      'duplication_similarity_threshold',
      'duplication_min_lines',
      'bundle_completeness',
      'evidence_existence_gate',
      'decision_arm_mode',
      'decision_arm_plan_threshold',
      'decision_arm_max_per_change',
      'ai_attribution',
      'stage_isolation_lanes',
      'spec_pipeline_enabled',
      'spec_pipeline_clarification',
      'spec_pipeline_final_review',
      'spec_pipeline_token_ceiling',
      'spec_grounding_budget_ms',
      'spec_pipeline_experts_enabled',
      'spec_pipeline_adoption',
      'spec_pipeline_experts_lanes',
      'spec_pipeline_standing_experts',
      'visual_evidence_mode',
      'checks_flaky_under_parallel',
    ],
  },
  {
    present: () => false,
    keys: ['plugin_migration', 'claude_install_mode'],
  },
  {
    present: () => false,
    keys: ['team_bootstrap_enabled'],
  },
  {
    present: () => false,
    keys: ['hud_view', 'hud_chime'],
  },
  {
    present: () => false,
    keys: FRAMEWORK_CONFIG_SPECS.filter((spec) => spec.section === AUTHORING_SECTION).map(
      (spec) => spec.key,
    ),
  },
  {
    present: () => false,
    keys: STAGE_SETTING_STAGES.flatMap((stage) => [
      `stage_effort_${stage}`,
      `stage_model_${stage}`,
    ]),
  },
];

export function syncFrameworkConfig(projectRoot: string, profile: Partial<ProjectProfile>): void {
  const nonDefault = frameworkOverridesToFlat(profile);
  for (const section of CONFIG_KEY_SECTIONS) {
    if (!section.present(profile)) {
      continue;
    }
    for (const key of section.keys) {
      const value = nonDefault.get(key);
      if (value !== undefined) {
        setConfigValue(projectRoot, key, value);
      } else {
        removeConfigValue(projectRoot, key);
      }
    }
  }
}
