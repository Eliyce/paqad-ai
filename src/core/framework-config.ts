import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from './constants/paths.js';
import { versionAtLeast } from './version-compare.js';
import { normalizeIntelligenceConfig } from './project-intelligence.js';
import { LANES, type Lane } from './types/routing.js';
import type {
  DecisionProfileConfig,
  EfficiencyConfig,
  EnterpriseConfig,
  EscalationConfig,
  EscalationMode,
  IntelligenceConfig,
  ModelRoutingConfig,
  ProjectFeatureFlags,
  ProjectProfile,
  ResearchDepth,
  StrictnessConfig,
} from './types/project-profile.js';
import { ESCALATION_MODES, RESEARCH_DEPTHS } from './types/project-profile.js';

declare const __PKG_VERSION__: string;

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

export const CONFIG_GROUP_FILES: Record<ConfigGroup, string> = {
  app: '.config.app',
  rag: '.config.rag',
  models: '.config.models',
  policy: '.config.policy',
};

export interface FrameworkConfigSpec {
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

export const FRAMEWORK_CONFIG_SPECS: readonly FrameworkConfigSpec[] = [
  {
    key: 'paqad_enable',
    env: 'PAQAD_ENABLE',
    type: 'boolean',
    default: true,
    group: 'app',
    section: 'Framework master switch',
    comment: 'Turn paqad off entirely (vanilla mode). Absent/true = on.',
  },
  {
    key: 'auto_update',
    env: 'PAQAD_AUTO_UPDATE',
    type: 'boolean',
    default: true,
    group: 'app',
    section: 'Version & updates',
    comment: 'Pull newer framework versions in the background on session start.',
  },
  {
    key: 'minimum_version',
    env: 'PAQAD_MINIMUM_VERSION',
    type: 'string',
    default: 'latest',
    group: 'app',
    section: 'Version & updates',
    comment:
      'Refuse to run below this version. "latest" = no fixed floor, track newest. Or pin e.g. 1.28.1.',
  },
  {
    key: 'version_check_interval_hours',
    env: 'PAQAD_VERSION_CHECK_INTERVAL_HOURS',
    type: 'number',
    default: 12,
    group: 'app',
    section: 'Version & updates',
    comment: 'How often the background version check runs.',
  },
  {
    key: 'enterprise',
    env: 'PAQAD_ENTERPRISE',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Enterprise / governance (licensed, off by default)',
    comment: 'Master switch for the enterprise/governance capabilities.',
  },
  {
    key: 'enterprise_evidence_ledger',
    env: 'PAQAD_ENTERPRISE_EVIDENCE_LEDGER',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Enterprise / governance (licensed, off by default)',
    comment: 'Write the receipt + evidence ledger set under .paqad/ledger/.',
  },
  {
    key: 'enterprise_ai_bom',
    env: 'PAQAD_ENTERPRISE_AI_BOM',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Enterprise / governance (licensed, off by default)',
    comment: 'Write the CycloneDX ai-bom.json view.',
  },
  {
    key: 'enterprise_compliance_citations',
    env: 'PAQAD_ENTERPRISE_COMPLIANCE_CITATIONS',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Enterprise / governance (licensed, off by default)',
    comment: 'Resolve framework citations into the receipt (token-spending path).',
  },
  {
    key: 'spec_only_mode',
    env: 'PAQAD_SPEC_ONLY_MODE',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Feature flags',
    comment: 'Stop after the spec phase; do not implement.',
  },
  {
    key: 'market_research',
    env: 'PAQAD_MARKET_RESEARCH',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Feature flags',
    comment: 'Enable the market-research agent in planning.',
  },
  {
    key: 'design_research',
    env: 'PAQAD_DESIGN_RESEARCH',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Feature flags',
    comment: 'Enable the design-research agent in planning.',
  },
  {
    key: 'team_agents',
    env: 'PAQAD_TEAM_AGENTS',
    type: 'boolean',
    default: true,
    group: 'app',
    section: 'Feature flags',
    comment: 'Use the multi-agent team for full-lane work.',
  },
  {
    key: 'analytics_instrumentation',
    env: 'PAQAD_ANALYTICS_INSTRUMENTATION',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Feature flags',
    comment:
      'Opt in to complementary analytics instrumentation. ' +
      'OFF (default) is silent; ON authorizes wiring tracking + a per-event tracking-plan doc.',
  },
  {
    key: 'site_map',
    env: 'PAQAD_SITE_MAP',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Feature flags',
    comment:
      'Opt in to the Site Map & Journeys capability — a verified behavioural map of the ' +
      'app stored at docs/site-map/ (the Site map dashboard area + `site-map` workflow). ' +
      'OFF (default) is completely inert; ON also requires the coding capability at its consumers.',
  },
  {
    key: 'visual_evidence',
    env: 'PAQAD_VISUAL_EVIDENCE',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Feature flags',
    comment:
      'Capture screenshots of documented flows for frontend changes as feature-bundle ' +
      'evidence. ON also requires the coding capability at its consumers.',
  },
  {
    key: 'lean_rules',
    env: 'PAQAD_LEAN_RULES',
    type: 'boolean',
    default: true,
    group: 'app',
    section: 'Feature flags',
    comment:
      'Token-neutral rule loading. ON (default) delivers the lean rule contract ' +
      '(manifest + only the rule text that applies to the files in play) and lifts the full-load ' +
      'mandate. OFF restores loading docs/instructions/rules in full every session.',
  },
  {
    key: 'feature_report',
    env: 'PAQAD_FEATURE_REPORT',
    type: 'boolean',
    default: true,
    group: 'app',
    section: 'Feature flags',
    comment:
      'Render a per-feature evidence report.html from the bundle at end-of-change. ' +
      'ON (default) is local, free, and zero-LLM. OFF stops writing the page.',
  },
  {
    key: 'metrics_enabled',
    env: 'PAQAD_METRICS_ENABLED',
    type: 'boolean',
    default: true,
    group: 'app',
    section: 'Feature flags',
    comment:
      'Compute the per-change shape metrics (duplication on new code + cross-file reuse rate) ' +
      'and surface them on the receipt, ledger, and dashboard. ON (default) is ' +
      'local, deterministic, and zero-LLM — it folds over caches the gates already produced. ' +
      'OFF stops computing and recording them.',
  },
  {
    key: 'checks_parallel',
    env: 'PAQAD_CHECKS_PARALLEL',
    type: 'boolean',
    default: true,
    group: 'app',
    section: 'Feature flags',
    comment:
      "Run the checks stage concurrently and use the test runner's own parallel mode when the " +
      'project has it. OFF restores the one-after-another run.',
  },
  {
    key: 'checks_max_processes',
    env: 'PAQAD_CHECKS_MAX_PROCESSES',
    type: 'number',
    default: 0,
    group: 'app',
    section: 'Feature flags',
    comment:
      'Cap on parallel test processes. 0 = auto (cores minus one, capped by memory and container ' +
      'limits).',
  },
  {
    key: 'hud_view',
    env: 'PAQAD_HUD_VIEW',
    type: 'boolean',
    default: true,
    group: 'app',
    section: 'Feature flags',
    comment:
      'Show the paqad HUD band above the prompt in the Claude Code plugin. OFF shows no band ' +
      'and registers no /paqad command.',
  },
  {
    key: 'hud_chime',
    env: 'PAQAD_HUD_CHIME',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Feature flags',
    comment:
      'Play a short chime in the Claude Code plugin when the verdict lands, once per verdict. ' +
      'A chime only, never speech.',
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
      'on | off — fleet-wide switch to move existing npm Claude Code users to the paqad plugin ' +
      'automatically in the background. Default off until manual sign-off; Claude Code only, npm ' +
      'is never removed and stays the fallback.',
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
      'auto | plugin | settings — per-project override of the plugin migration. settings never ' +
      'migrates (stay on npm hooks); plugin forces the migration even while plugin_migration is ' +
      'off; auto follows plugin_migration.',
  },

  {
    key: 'rag_enabled',
    env: 'PAQAD_RAG_ENABLED',
    type: 'boolean',
    default: false,
    group: 'rag',
    section: 'Intelligence / RAG',
    comment: 'Enable retrieval-augmented context loading.',
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
    comment: 'local | openai. Unset uses the local model.',
  },
  {
    key: 'rag_embedding_model',
    env: 'PAQAD_RAG_EMBEDDING_MODEL',
    type: 'string',
    default: undefined,
    optional: true,
    group: 'rag',
    section: 'Intelligence / RAG',
    comment: 'Override the embedding model id. Unset = provider default.',
  },
  {
    key: 'rag_similarity_threshold',
    env: 'PAQAD_RAG_SIMILARITY_THRESHOLD',
    type: 'number',
    default: 0.75,
    group: 'rag',
    section: 'Intelligence / RAG',
    comment: 'Minimum cosine similarity for a chunk to be retrieved.',
  },
  {
    key: 'rag_relief_floor',
    env: 'PAQAD_RAG_RELIEF_FLOOR',
    type: 'number',
    default: 0.35,
    group: 'rag',
    section: 'Intelligence / RAG',
    comment:
      'Relief band for floor-with-relief. When nothing clears rag_similarity_threshold, ' +
      'the top slices at or above this lower score are delivered tagged low-confidence.',
  },
  {
    key: 'rag_top_n',
    env: 'PAQAD_RAG_TOP_N',
    type: 'number',
    default: 20,
    group: 'rag',
    section: 'Intelligence / RAG',
    comment: 'Max chunks retrieved per query.',
  },
  {
    key: 'rag_max_file_size',
    env: 'PAQAD_RAG_MAX_FILE_SIZE',
    type: 'number',
    default: 153600,
    group: 'rag',
    section: 'Intelligence / RAG',
    comment: 'Skip indexing files larger than this many bytes.',
  },
  {
    key: 'rag_base_branch',
    env: 'PAQAD_RAG_BASE_BRANCH',
    type: 'string',
    default: undefined,
    optional: true,
    group: 'rag',
    section: 'Intelligence / RAG',
    comment: 'Base branch for branch-aware RAG. Unset auto-detects main->master.',
  },
  {
    key: 'existing_surface_tokens',
    env: 'PAQAD_EXISTING_SURFACE_TOKENS',
    type: 'number',
    default: 1000,
    group: 'rag',
    section: 'Intelligence / RAG',
    comment:
      'Token budget for the feature-development "Existing surface" planning digest ' +
      '(existing symbols the model should reuse). Cards drop by rank past this budget.',
  },

  {
    key: 'research_depth',
    env: 'PAQAD_RESEARCH_DEPTH',
    type: 'enum',
    enumValues: RESEARCH_DEPTHS,
    default: 'standard',
    group: 'models',
    section: 'Research & model routing',
    comment: 'cutting-edge | standard | conservative.',
  },
  {
    key: 'model_default',
    env: 'PAQAD_MODEL_DEFAULT',
    type: 'string',
    default: 'gpt-5',
    group: 'models',
    section: 'Research & model routing',
    comment: 'Default model for routine work.',
  },
  {
    key: 'model_reasoning',
    env: 'PAQAD_MODEL_REASONING',
    type: 'string',
    default: 'gpt-5',
    group: 'models',
    section: 'Research & model routing',
    comment: 'Model for heavy reasoning / planning.',
  },
  {
    key: 'model_fast',
    env: 'PAQAD_MODEL_FAST',
    type: 'string',
    default: 'gpt-5-mini',
    group: 'models',
    section: 'Research & model routing',
    comment: 'Cheap/fast model for lightweight steps.',
  },

  ...STAGE_SETTING_STAGES.flatMap((stage): FrameworkConfigSpec[] => [
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
        `inherit | haiku | sonnet | opus. The model the ${stage} stage helper runs on. inherit ` +
        'uses the model of the main session. Run `paqad-ai stage settings` to apply it on the next ' +
        'dispatch; the helper files keep the defaults.',
    },
  ]),

  {
    key: 'full_lane_default',
    env: 'PAQAD_FULL_LANE_DEFAULT',
    type: 'boolean',
    default: false,
    group: 'policy',
    section: 'Strictness / quality gates',
    comment: 'Route every task through the full (heaviest) lane by default.',
  },
  {
    key: 'require_adversarial_review',
    env: 'PAQAD_REQUIRE_ADVERSARIAL_REVIEW',
    type: 'boolean',
    default: true,
    group: 'policy',
    section: 'Strictness / quality gates',
    comment: 'Require an adversarial review pass before delivery.',
  },
  {
    key: 'block_on_stale_docs',
    env: 'PAQAD_BLOCK_ON_STALE_DOCS',
    type: 'boolean',
    default: true,
    group: 'policy',
    section: 'Strictness / quality gates',
    comment: 'Block delivery when canonical docs are out of date.',
  },
  {
    key: 'require_db_review_for_migrations',
    env: 'PAQAD_REQUIRE_DB_REVIEW_FOR_MIGRATIONS',
    type: 'boolean',
    default: true,
    group: 'policy',
    section: 'Strictness / quality gates',
    comment: 'Require a database review when a change includes migrations.',
  },
  {
    key: 'escalate_destructive_operations',
    env: 'PAQAD_ESCALATE_DESTRUCTIVE_OPERATIONS',
    type: 'enum',
    enumValues: ESCALATION_MODES,
    default: 'block',
    group: 'policy',
    section: 'Escalation policy',
    comment: 'block | require_approval | warn — for destructive operations.',
  },
  {
    key: 'escalate_risky_migrations',
    env: 'PAQAD_ESCALATE_RISKY_MIGRATIONS',
    type: 'enum',
    enumValues: ESCALATION_MODES,
    default: 'warn',
    group: 'policy',
    section: 'Escalation policy',
    comment: 'block | require_approval | warn — for risky migrations.',
  },
  {
    key: 'escalate_security_findings',
    env: 'PAQAD_ESCALATE_SECURITY_FINDINGS',
    type: 'enum',
    enumValues: ESCALATION_MODES,
    default: 'block',
    group: 'policy',
    section: 'Escalation policy',
    comment: 'block | require_approval | warn — for security findings.',
  },
  {
    key: 'escalate_db_row_threshold',
    env: 'PAQAD_ESCALATE_DB_ROW_THRESHOLD',
    type: 'number',
    default: 10000,
    group: 'policy',
    section: 'Escalation policy',
    comment: 'Row count above which a data operation escalates.',
  },
  {
    key: 'decisions_ask_threshold',
    env: 'PAQAD_DECISIONS_ASK_THRESHOLD',
    type: 'enum',
    enumValues: ASK_THRESHOLDS,
    default: 'strict',
    group: 'policy',
    section: 'Decisions (pause-contract tuning)',
    comment: 'strict | balanced | permissive — how eagerly to pause and ask.',
  },
  {
    key: 'decisions_max_screens_per_task',
    env: 'PAQAD_DECISIONS_MAX_SCREENS_PER_TASK',
    type: 'number',
    default: 3,
    group: 'policy',
    section: 'Decisions (pause-contract tuning)',
    comment: 'Max decision screens surfaced per task.',
  },
  {
    key: 'decisions_idle_timeout_minutes',
    env: 'PAQAD_DECISIONS_IDLE_TIMEOUT_MINUTES',
    type: 'number',
    default: 30,
    group: 'policy',
    section: 'Decisions (pause-contract tuning)',
    comment: 'Auto-resolve a pending decision after this idle window.',
  },
  {
    key: 'stages_mode',
    env: 'PAQAD_STAGES_MODE',
    type: 'enum',
    enumValues: STAGE_RULE_MODES,
    default: 'strict',
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment: 'off | warn | strict — feature-development stage-completeness gate (default strict).',
  },
  {
    key: 'rule_compliance',
    env: 'PAQAD_RULE_COMPLIANCE',
    type: 'enum',
    enumValues: STAGE_RULE_MODES,
    default: 'warn',
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment: 'off | warn | strict — scripted-rule enforcement from the working tree.',
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
      'blocking-only | all — rule scripts run before an edit. blocking-only runs only the ' +
      'deterministic changed-files scripts and the rest at turn end; all runs every script.',
  },
  {
    key: 'rule_gate_concurrency',
    env: 'PAQAD_RULE_GATE_CONCURRENCY',
    type: 'string',
    default: 'auto',
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment:
      'auto | 1-8 — rule scripts run at once. auto = CPU cores minus one, at most 8; 1 runs ' +
      'them one after another.',
  },
  {
    key: 'rule_gate_budget_ms',
    env: 'PAQAD_RULE_GATE_BUDGET_MS',
    type: 'number',
    default: RULE_GATE_DEFAULTS.budget_ms,
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment:
      'Time in ms (500-9000) the pre-edit rule check may take from the hook start, under both ' +
      'rule_gate_pre_edit values. Past it the edit goes ahead and the checks block at turn end.',
  },
  {
    key: 'analytics_strictness',
    env: 'PAQAD_ANALYTICS_STRICTNESS',
    type: 'enum',
    enumValues: STAGE_RULE_MODES,
    default: 'warn',
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment:
      'off | warn | strict — analytics instrumentation completeness. ' +
      'warn (default) flags a missing event doc; strict blocks on Done; opt-in, never auto-escalated.',
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
      'off | warn | strict — new-code duplication gate. warn (default) flags a ' +
      'near-copy of existing code; strict blocks it. Ships warn for a two-cycle bake-in.',
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
      'off | warn | strict: mutation testing on changed code. Opt-in: off by ' +
      'default. It runs only where the project calls runtime/scripts/verify-backstop.mjs from its ' +
      'own CI or pre-push hook, never at the end of an agent turn, and the project supplies the ' +
      'mutation tool for its stack. The project test command runs first; a red suite reads did ' +
      'not run. warn: a surviving mutant reads Inconclusive. strict: it fails the check.',
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
      'off | warn | strict — end-of-change check that a feature-development bundle carries every ' +
      'required file (feature.json / plan / spec / review / stage-evidence / delivery, plus the ' +
      'flag-gated rule-run / change-metrics / duplication / report / rag / receipt / evidence / ' +
      'ai-bom). strict (default) FAILS the change when a required file is missing/empty/invalid, ' +
      'naming the file and its writer; warn surfaces it as Inconclusive without blocking; off ' +
      'falls back to the deprecated evidence_existence_gate.',
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
      'pass | warn | fail — what a test that fails in the parallel run but passes alone does. warn ' +
      '(default): never blocks, recorded, one receipt line. pass: recorded only. fail: blocks. Team ' +
      'value is the floor; local/env may only raise it.',
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
      'warn | strict — how firmly the visual-evidence gate enforces once visual_evidence is on ' +
      'and a change is frontend-triggering. warn (default): an environmental miss ' +
      '(browser not provisioned, app not reachable, a failed selector, an absent/partial manifest) ' +
      'reads Inconclusive without blocking. strict: the same misses FAIL the change, and so does ' +
      'a frontend change with nothing captured because no documented flow or capture script ' +
      'exists, unless you attach screenshots (paqad-ai visual-evidence attach) or ' +
      'record a waiver decision (the gate prints the exact decision command). Under warn those ' +
      'skips stay skipped and show a skip line. Team value is the floor; local/env may only raise ' +
      'warn to strict.',
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
      'DEPRECATED: superseded by bundle_completeness, which covers every bundle file ' +
      'and can fail. This warn-only check (rule-run / duplication / change-metrics / rag) now runs ' +
      'ONLY when bundle_completeness=off. warn (default) backfills the recoverable ones from the ' +
      'caches and reports an unrecoverable RAG gap as Inconclusive; it NEVER blocks. off disables it.',
  },
  {
    key: 'duplication_similarity_threshold',
    env: 'PAQAD_DUPLICATION_SIMILARITY_THRESHOLD',
    type: 'number',
    default: 0.9,
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment:
      'Minimum similarity (0..1) for a blocking duplication finding. Default 0.90 — ' +
      'conservative, precision over recall. The 0.80–0.90 band routes to review, never blocks.',
  },
  {
    key: 'duplication_min_lines',
    env: 'PAQAD_DUPLICATION_MIN_LINES',
    type: 'number',
    default: 8,
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment:
      'Minimum meaningful-line span a new code block must have to be scored for duplication. ' +
      'Default 8 — shorter snippets are never flagged.',
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
      'off | warn | strict — arm the create-vs-reuse decision pause from evidence. ' +
      'warn (default) reports the fork; strict opens a pause that blocks edits until answered.',
  },
  {
    key: 'decision_arm_plan_threshold',
    env: 'PAQAD_DECISION_ARM_PLAN_THRESHOLD',
    type: 'number',
    default: 0.85,
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment:
      'Minimum name similarity (0..1) between a planned new construct and an existing symbol ' +
      'before it counts as a reuse fork. Default 0.85.',
  },
  {
    key: 'decision_arm_max_per_change',
    env: 'PAQAD_DECISION_ARM_MAX_PER_CHANGE',
    type: 'number',
    default: 1,
    group: 'policy',
    section: 'Enforcement (capability modes — team value is a floor)',
    comment:
      'How many evidence-armed decision pauses one change may open. Default 1 — ' +
      'only the strongest fork is asked; the rest are reported as warnings.',
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
      'keep | strip — what happens to the CODING AGENT vendor attribution on your commits and PRs. ' +
      'strip (default) suppresses it where the provider exposes a project-level knob ' +
      '(Claude Code, Aider) and warns at delivery where it does not (Codex, Cursor are user-level ' +
      "only). paqad's own delivery footer is never touched by this knob.",
  },
  {
    key: 'stage_isolation_lanes',
    env: 'PAQAD_STAGE_ISOLATION_LANES',
    type: 'string',
    default: 'full',
    group: 'policy',
    section: 'Stage isolation',
    comment:
      'Comma-separated lanes (fast, graduated, full) on which each feature-development stage runs ' +
      'in its own stage helper on a host that can dispatch subagents (Claude Code, Codex). On ' +
      'other lanes the main agent runs every stage itself, with the same stages, artifacts and ' +
      'gates. Default: full. Set graduated,full to restore the old behaviour. full is always ' +
      'included; an empty or unreadable value gives the default.',
  },
  {
    key: 'spec_pipeline_enabled',
    env: 'PAQAD_SPEC_PIPELINE_ENABLED',
    type: 'boolean',
    default: SPEC_PIPELINE_DEFAULTS.spec_pipeline_enabled,
    group: 'policy',
    section: 'Spec pipeline',
    comment:
      'The grounded prompt->spec pipeline (`paqad-ai spec pipeline`). On by default on the ' +
      'graduated and full lanes; the fast lane never runs it. Set it to false to ' +
      'switch it off: feature-development then works as it did before the pipeline (FR-11). It ' +
      'sits upstream of the edit lock and feeds `spec freeze`.',
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
      'off | warn | strict — the switchable clarification (question-round) gate. ' +
      'warn (advisory): ask questions on an unclear prompt but never block. strict (required): ask ' +
      'and hold until answered or explicitly deferred. off: never ask. The fixed spine ' +
      '(grounding, no-invented-requirements, traceability) is never switchable.',
  },
  {
    key: 'spec_pipeline_final_review',
    env: 'PAQAD_SPEC_PIPELINE_FINAL_REVIEW',
    type: 'enum',
    enumValues: STAGE_RULE_MODES,
    default: 'off',
    group: 'policy',
    section: 'Spec pipeline',
    comment:
      'off | warn | strict — the switchable final-review gate before freeze. ' +
      'off: show a non-blocking readable spec. warn (advisory): show and freeze. strict (required): ' +
      'a human must approve before freeze, recording a named human. Independent of the A5 gate.',
  },
  {
    key: 'spec_pipeline_token_ceiling',
    env: 'PAQAD_SPEC_PIPELINE_TOKEN_CEILING',
    type: 'number',
    default: 40000,
    group: 'policy',
    section: 'Spec pipeline',
    comment:
      'Per-run model-token ceiling for the spec pipeline. Exceeding it raises a ' +
      'recorded warning (never a block) so R1 (over-heavy pipeline) is watched with data, not vibes.',
  },
  {
    key: 'spec_grounding_budget_ms',
    env: 'PAQAD_SPEC_GROUNDING_BUDGET_MS',
    type: 'number',
    default: 15000,
    group: 'policy',
    section: 'Spec pipeline',
    comment:
      'Milliseconds `spec pipeline start` gives retrieval to ground the request. Past it, or ' +
      'with an empty index or no embedding key, start grounds on the docs alone and records ' +
      'grounding.mode=lexical-fallback with the reason.',
  },
  {
    key: 'spec_pipeline_experts_enabled',
    env: 'PAQAD_SPEC_PIPELINE_EXPERTS_ENABLED',
    type: 'boolean',
    default: SPEC_PIPELINE_DEFAULTS.spec_pipeline_experts_enabled,
    group: 'policy',
    section: 'Spec pipeline',
    comment:
      'The expert roster: a fast-tier skill decides which experts ' +
      '(db, security, ui, ...) a request needs, and their notes feed the crafted spec. On by ' +
      'default on the graduated and full lanes. Set it to false to switch it off: ' +
      'then zero Phase 2 code runs and a pipeline run is byte-identical to v1 (P2-INV-1). Needs ' +
      'spec_pipeline_enabled on to have any effect.',
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
      'warn | strict: how firmly the specification stage adopts the pipeline once ' +
      'spec_pipeline_enabled is on. strict (the default): `spec freeze` refuses a ' +
      'spec the pipeline did not produce; the only exit is `--manual --reason "<why>"`, which is ' +
      'recorded on the frozen spec. Set it to warn to soften this: the stage still tells the ' +
      'agent to produce the spec through `paqad-ai spec pipeline`, but a hand-written spec ' +
      'freezes, recorded as pipeline.produced=false and shown in the receipt. No effect while ' +
      'spec_pipeline_enabled is off.',
  },
  {
    key: 'spec_pipeline_experts_lanes',
    env: 'PAQAD_SPEC_PIPELINE_EXPERTS_LANES',
    type: 'string',
    default: 'full',
    group: 'policy',
    section: 'Spec pipeline',
    comment:
      'Comma-separated lanes (graduated, full) on which the standing experts sit at every spec. ' +
      'On other pipeline lanes only the on-call experts the detector names are seated, plus ' +
      'security-auditor when a planned path is sensitive, and the High Table is skipped when ' +
      'nobody is named. Default: full. Set graduated,full to restore the old behaviour. full is ' +
      'always included. Review is unaffected.',
  },
  {
    key: 'spec_pipeline_standing_experts',
    env: 'PAQAD_SPEC_PIPELINE_STANDING_EXPERTS',
    type: 'string',
    default: 'product-owner,application-architect,user-flow-writer,qa-engineer',
    group: 'policy',
    section: 'Spec pipeline',
    comment:
      'Comma-separated expert roles that sit at the table on EVERY spec run once ' +
      'spec_pipeline_experts_enabled is on, whatever the detector picked. Default: ' +
      'product-owner,application-architect,user-flow-writer,qa-engineer. The other experts stay ' +
      'on call and are picked per request. Empty means no standing experts (the detector alone ' +
      'decides, as before). A role outside the expert roster is ignored with a doctor warning. ' +
      'No effect while the pipeline or the experts are off.',
  },
] as const;

function stageEffortComment(stage: string): string {
  const base =
    `low | medium | high | xhigh | inherit. How hard the ${stage} stage helper thinks. inherit ` +
    'uses the effort of the main session. Run `paqad-ai stage settings` to apply it on the next ' +
    'dispatch; the helper files keep the defaults.';
  return stage === 'review' ? `${base} You may lower it, but a lighter review catches less.` : base;
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
  strictness: StrictnessConfig;
  escalation: EscalationConfig;
  features: ProjectFeatureFlags;
  research: { depth: ResearchDepth };
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

export function readDotConfig(projectRoot: string): Map<string, string> {
  try {
    return parseDotConfig(readFileSync(join(projectRoot, PATHS.PROJECT_CONFIG), 'utf8'));
  } catch {
    return new Map();
  }
}

export function listConfigsFiles(projectRoot: string): string[] {
  const dir = join(projectRoot, PATHS.PROJECT_CONFIGS_DIR);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => /^\.config\..+/u.test(name) && name !== '.config.example')
    .sort()
    .map((name) => join(dir, name));
}

export interface ConfigsCollision {
  key: string;
  files: string[];
}

export function readConfigsDir(projectRoot: string): {
  merged: Map<string, string>;
  collisions: ConfigsCollision[];
  sources: Map<string, string>;
} {
  const merged = new Map<string, string>();
  const seenIn = new Map<string, string[]>();
  for (const file of listConfigsFiles(projectRoot)) {
    let parsed: Map<string, string>;
    try {
      parsed = parseDotConfig(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    for (const [key, value] of parsed) {
      merged.set(key, value);
      seenIn.set(key, [...(seenIn.get(key) ?? []), file]);
    }
  }
  const collisions: ConfigsCollision[] = [];
  const sources = new Map<string, string>();
  for (const [key, files] of seenIn) {
    sources.set(key, files[files.length - 1]!);
    if (files.length > 1) {
      collisions.push({ key, files });
    }
  }
  return { merged, collisions, sources };
}

export function layeredConfigMap(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Map<string, string> {
  const merged = new Map<string, string>();
  for (const [key, value] of readConfigsDir(projectRoot).merged) {
    merged.set(key, value);
  }
  for (const [key, value] of readDotConfig(projectRoot)) {
    merged.set(key, value);
  }
  for (const spec of FRAMEWORK_CONFIG_SPECS) {
    const raw = env[spec.env];
    if (typeof raw === 'string' && raw.trim() !== '') {
      merged.set(spec.key, raw);
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

export function setGroupConfigValue(
  projectRoot: string,
  group: ConfigGroup,
  key: string,
  value: string,
): string {
  const path = join(projectRoot, PATHS.PROJECT_CONFIGS_DIR, CONFIG_GROUP_FILES[group]);
  let existing = '';
  try {
    existing = readFileSync(path, 'utf8');
  } catch {}

  const lines = existing.replace(/\n+$/u, '').split(/\r?\n/);
  const escapedKey = escapeRegExp(key);
  const assignmentRe = new RegExp(`^\\s*(?:export\\s+)?${escapedKey}\\s*=`, 'u');
  const commentedRe = new RegExp(`^\\s*#\\s*(?:export\\s+)?${escapedKey}\\s*=`, 'u');
  const activeIndex = lines.findIndex((line) => assignmentRe.test(line));
  const targetIndex =
    activeIndex === -1 ? lines.findIndex((line) => commentedRe.test(line)) : activeIndex;

  if (targetIndex === -1) {
    if (lines.length === 1 && lines[0] === '') {
      lines[0] = `${key}=${value}`;
    } else {
      lines.push(`${key}=${value}`);
    }
  } else {
    lines[targetIndex] = `${key}=${value}`;
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
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
    strictness: {
      full_lane_default: rb('full_lane_default'),
      require_adversarial_review: rb('require_adversarial_review'),
      block_on_stale_docs: rb('block_on_stale_docs'),
      require_db_review_for_migrations: rb('require_db_review_for_migrations'),
    },
    escalation: {
      destructive_operations: asEnum(
        raw.get('escalate_destructive_operations'),
        ESCALATION_MODES,
        defOf('escalate_destructive_operations') as EscalationMode,
      ),
      risky_migrations: asEnum(
        raw.get('escalate_risky_migrations'),
        ESCALATION_MODES,
        defOf('escalate_risky_migrations') as EscalationMode,
      ),
      security_findings: asEnum(
        raw.get('escalate_security_findings'),
        ESCALATION_MODES,
        defOf('escalate_security_findings') as EscalationMode,
      ),
      db_row_threshold: rn('escalate_db_row_threshold'),
    },
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
    research: {
      depth: asEnum(
        raw.get('research_depth'),
        RESEARCH_DEPTHS,
        defOf('research_depth') as ResearchDepth,
      ),
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
      max_screens_per_task: rn('decisions_max_screens_per_task'),
      idle_timeout_minutes: rn('decisions_idle_timeout_minutes'),
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

export const FRAMEWORK_CONFIG_SECTIONS = [
  'paqad',
  'enterprise',
  'intelligence',
  'strictness',
  'escalation',
  'features',
  'research',
  'model_routing',
  'efficiency',
] as const;

export function applyFrameworkConfigToProfile(
  base: ProjectProfile,
  resolved: ResolvedFrameworkConfig = DEFAULT_FRAMEWORK_CONFIG,
): ProjectProfile {
  return {
    ...base,
    paqad: resolved.paqad,
    enterprise: resolved.enterprise,
    intelligence: resolved.intelligence,
    strictness: resolved.strictness,
    escalation: resolved.escalation,
    features: resolved.features,
    research: resolved.research,
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

const CONFIG_GROUP_TITLES: Record<ConfigGroup, string> = {
  app: 'Application, version, enterprise, and feature flags',
  rag: 'Intelligence / RAG',
  models: 'Research depth, model routing, and stage helper effort and model',
  policy: 'Quality, escalation, and decision policy',
};

const CONFIG_GROUP_INTROS: Record<ConfigGroup, string[]> = {
  app: [
    'The framework master switch, the background version/update policy, the licensed',
    'enterprise/governance switches, and the planning feature flags.',
  ],
  rag: [
    'Retrieval-augmented context loading: whether it is on, the embedding provider and',
    'model, and the retrieval tuning (similarity threshold, top-N, file-size limit).',
  ],
  models: [
    'How deep research goes, which models handle routine, heavy-reasoning, and',
    'fast/cheap work, and the effort and model each feature-development stage helper',
    'runs at (applied on the next dispatch through `paqad-ai stage settings`).',
  ],
  policy: [
    'Strictness gates (adversarial review, stale-doc blocking, DB-migration review),',
    'escalation modes for risky operations, and decision-pause tuning.',
  ],
};

function renderDefault(spec: FrameworkConfigSpec): string {
  return spec.default === undefined ? '' : String(spec.default);
}

function fileHasKey(text: string, key: string): boolean {
  return new RegExp(`^\\s*#?\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=`, 'mu').test(text);
}

export function generateGroupConfig(
  group: ConfigGroup,
  overrides: Map<string, string> = new Map(),
): string {
  const lines: string[] = [
    `# .paqad/configs/${CONFIG_GROUP_FILES[group]} — ${CONFIG_GROUP_TITLES[group]}`,
    '#',
    ...CONFIG_GROUP_INTROS[group].map((l) => `# ${l}`),
    '#',
    '# Every key below is COMMENTED OUT, so paqad uses its built-in default until you',
    '# uncomment a line to override it. Precedence, highest first: PAQAD_* env var >',
    '# your local ../.config > these tracked team files > code default. This file is',
    '# tracked; `paqad-ai update` refreshes it and keeps every value you uncommented.',
    '',
  ];

  let currentSection = '';
  for (const spec of FRAMEWORK_CONFIG_SPECS.filter((s) => s.group === group)) {
    if (spec.section !== currentSection) {
      if (currentSection !== '') {
        lines.push('');
      }
      lines.push(`# ── ${spec.section} ${'─'.repeat(Math.max(0, 56 - spec.section.length))}`);
      currentSection = spec.section;
    }
    lines.push(`# ${spec.comment} (env: ${spec.env})`);
    const override = overrides.get(spec.key);
    lines.push(
      override !== undefined ? `${spec.key}=${override}` : `# ${spec.key}=${renderDefault(spec)}`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

export function syncGroupConfigs(projectRoot: string): string[] {
  const written: string[] = [];
  if (checkoutIsNewer(projectRoot)) return written;
  for (const group of Object.keys(CONFIG_GROUP_FILES) as ConfigGroup[]) {
    const file = join(projectRoot, PATHS.PROJECT_CONFIGS_DIR, CONFIG_GROUP_FILES[group]);
    let existing: string | null;
    try {
      existing = readFileSync(file, 'utf8');
    } catch {
      existing = null;
    }
    mkdirSync(dirname(file), { recursive: true });

    if (existing === null) {
      writeFileSync(file, generateGroupConfig(group), 'utf8');
      written.push(file);
      continue;
    }

    const missing = FRAMEWORK_CONFIG_SPECS.filter(
      (s) => s.group === group && !fileHasKey(existing as string, s.key),
    );
    if (missing.length === 0) {
      continue;
    }
    const additions = ['', `# ── Added in a newer paqad version ${'─'.repeat(28)}`];
    for (const spec of missing) {
      additions.push(`# ${spec.comment} (env: ${spec.env})`);
      additions.push(`# ${spec.key}=${renderDefault(spec)}`);
    }
    writeFileSync(file, `${existing.replace(/\n+$/u, '')}\n${additions.join('\n')}\n`, 'utf8');
    written.push(file);
  }
  return written;
}

export function generateConfigsReadme(): string {
  const groupLines = (Object.keys(CONFIG_GROUP_FILES) as ConfigGroup[]).map(
    (group) => `- \`${CONFIG_GROUP_FILES[group]}\` — ${CONFIG_GROUP_TITLES[group]}`,
  );
  return [
    '# paqad team configuration (`.paqad/configs/`)',
    '',
    'Tracked, team-shared framework overrides. Onboarding writes one file per group,',
    'each pre-filled with every knob in that group, commented out and documented:',
    '',
    ...groupLines,
    '',
    'Every file in this directory is merged into one map and read at runtime, so the',
    'split is purely organizational — a key works in any file.',
    '',
    'For a single copy-paste reference listing every knob in one place, see',
    '`../.config.example` (tracked, never read at runtime).',
    '',
    '## How to use',
    '',
    '- Uncomment a line to override that knob. While a key stays commented (or absent),',
    '  paqad uses its built-in code default, so an untouched project runs entirely on',
    '  defaults.',
    '- Keys must be globally unique across these files. The same key uncommented in two',
    '  files is a collision: the alphabetically-last filename wins, and `paqad-ai',
    '  onboard`/`update` reports it.',
    '- A teammate’s local `../.config` (git-ignored) overrides anything here, and a',
    '  `PAQAD_*` env var overrides everything.',
    '- `paqad-ai update` refreshes these files: it appends knobs added in a new version',
    '  (commented) and prunes knobs a new version removed, but never changes a value you',
    '  uncommented. It never resets your settings to defaults.',
    '- `../.config.example` names the paqad version that generated it. A paqad older than',
    '  that version leaves the example, these files and this README exactly as they are,',
    '  so a teammate on an older install never rewrites a newer checkout.',
    '',
  ].join('\n');
}

export function writeConfigsReadme(projectRoot: string): string {
  const path = join(projectRoot, PATHS.PROJECT_CONFIGS_README);
  if (checkoutIsNewer(projectRoot)) return path;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, generateConfigsReadme(), 'utf8');
  return path;
}

export function generateConfigExample(version: string = __PKG_VERSION__): string {
  const lines: string[] = [
    '# paqad framework configuration — catalog of every knob (.paqad/.config.example)',
    `${CONFIG_EXAMPLE_STAMP}${version}`,
    '#',
    '# A copy-paste reference: every framework knob, with its default, a one-line',
    '# explanation, and its PAQAD_* env equivalent. This file is NEVER read at',
    '# runtime. To override a knob, copy its line into a tracked configs/.config.*',
    '# file (team) or your git-ignored .config (local), uncomment it, and set a value.',
    '#',
    '# Precedence, highest first: PAQAD_* env var > .config (local) > configs/.config.*',
    '# (team) > code default. With nothing uncommented anywhere, every knob is at the',
    '# default shown below — identical to a fresh install.',
    '',
  ];

  let currentSection = '';
  for (const spec of FRAMEWORK_CONFIG_SPECS) {
    if (spec.section !== currentSection) {
      if (currentSection !== '') {
        lines.push('');
      }
      lines.push(`# ── ${spec.section} ${'─'.repeat(Math.max(0, 56 - spec.section.length))}`);
      currentSection = spec.section;
    }
    lines.push(`# ${spec.comment} (env: ${spec.env})`);
    lines.push(`# ${spec.key}=${renderDefault(spec)}`);
  }

  lines.push('');
  return lines.join('\n');
}

export function writeConfigExample(projectRoot: string): string {
  const path = join(projectRoot, PATHS.PROJECT_CONFIG_EXAMPLE);
  if (checkoutIsNewer(projectRoot)) return path;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, generateConfigExample(), 'utf8');
  return path;
}

const CONFIG_EXAMPLE_STAMP = '# generated by paqad-ai ';

export function checkoutIsNewer(projectRoot: string, version: string = __PKG_VERSION__): boolean {
  let example: string;
  try {
    example = readFileSync(join(projectRoot, PATHS.PROJECT_CONFIG_EXAMPLE), 'utf8');
  } catch {
    return false;
  }
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
  if (overrides.strictness) {
    const s = overrides.strictness;
    put('full_lane_default', s.full_lane_default, d.strictness.full_lane_default);
    put(
      'require_adversarial_review',
      s.require_adversarial_review,
      d.strictness.require_adversarial_review,
    );
    put('block_on_stale_docs', s.block_on_stale_docs, d.strictness.block_on_stale_docs);
    put(
      'require_db_review_for_migrations',
      s.require_db_review_for_migrations,
      d.strictness.require_db_review_for_migrations,
    );
  }
  if (overrides.escalation) {
    const e = overrides.escalation;
    put(
      'escalate_destructive_operations',
      e.destructive_operations,
      d.escalation.destructive_operations,
    );
    put('escalate_risky_migrations', e.risky_migrations, d.escalation.risky_migrations);
    put('escalate_security_findings', e.security_findings, d.escalation.security_findings);
    put('escalate_db_row_threshold', e.db_row_threshold, d.escalation.db_row_threshold);
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
  if (overrides.research) {
    put('research_depth', overrides.research.depth, d.research.depth);
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
    put(
      'decisions_max_screens_per_task',
      dec.max_screens_per_task,
      d.decisions.max_screens_per_task,
    );
    put(
      'decisions_idle_timeout_minutes',
      dec.idle_timeout_minutes,
      d.decisions.idle_timeout_minutes,
    );
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
    present: (p) => p.strictness !== undefined,
    keys: [
      'full_lane_default',
      'require_adversarial_review',
      'block_on_stale_docs',
      'require_db_review_for_migrations',
    ],
  },
  {
    present: (p) => p.escalation !== undefined,
    keys: [
      'escalate_destructive_operations',
      'escalate_risky_migrations',
      'escalate_security_findings',
      'escalate_db_row_threshold',
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
      'lean_rules',
      'feature_report',
      'metrics_enabled',
      'visual_evidence',
      'checks_parallel',
      'checks_max_processes',
    ],
  },
  { present: (p) => p.research !== undefined, keys: ['research_depth'] },
  {
    present: (p) => p.model_routing !== undefined,
    keys: ['model_default', 'model_reasoning', 'model_fast'],
  },
  {
    present: (p) => p.custom?.decisions !== undefined,
    keys: [
      'decisions_ask_threshold',
      'decisions_max_screens_per_task',
      'decisions_idle_timeout_minutes',
    ],
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
    keys: ['hud_view', 'hud_chime'],
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
