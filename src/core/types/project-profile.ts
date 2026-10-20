import type { ActiveCapability, Domain } from './domain.js';
import type { DetectedStackProfile } from './introspection.js';
import type { DecisionCategory } from '@/planning/decision-packet.js';

export const RESEARCH_DEPTHS = ['cutting-edge', 'standard', 'conservative'] as const;
export type ResearchDepth = (typeof RESEARCH_DEPTHS)[number];

export const ESCALATION_MODES = ['block', 'require_approval', 'warn'] as const;
export type EscalationMode = (typeof ESCALATION_MODES)[number];

export interface ProjectMetadata {
  name: string;
  id: string;
  description: string;
}

export interface ProjectCommands {
  install: string;
  dev: string;
  test: string;
  test_single: string;
  lint: string;
  format: string;
  migrate: string;
  build: string;
  test_parallel?: string;
}

export interface StrictnessConfig {
  full_lane_default: boolean;
  require_adversarial_review: boolean;
  block_on_stale_docs: boolean;
  require_db_review_for_migrations: boolean;
}

export interface CompliancePackConfig {
  name: string;
  enabled: boolean;
}

export interface ProjectFeatureFlags {
  spec_only_mode: boolean;
  market_research: boolean;
  design_research: boolean;
  team_agents: boolean;
  analytics_instrumentation: boolean;
  site_map: boolean;
  lean_rules: boolean;
  feature_report: boolean;
  metrics_enabled: boolean;
  visual_evidence: boolean;
  checks_parallel: boolean;
  checks_max_processes: number;
}

export const TICKET_PROVIDER_KINDS = ['jira', 'linear', 'github-issues', 'generic'] as const;
export type TicketProviderKind = (typeof TICKET_PROVIDER_KINDS)[number];

export interface ProjectMcpServer {
  name: string;
  enabled: boolean;
  kind?: TicketProviderKind;
  config?: Record<string, unknown>;
}

export type AutoResolveConfirmation = 'always' | 'batched' | 'never';
export type TicketWriteBackMode = 'never' | 'ask' | 'always';

export interface ModelRoutingConfig {
  default_model: string;
  reasoning_model: string;
  fast_model: string;
}

export const EMBEDDING_PROVIDER_NAMES = ['local', 'openai', 'voyageai'] as const;
export type EmbeddingProviderName = (typeof EMBEDDING_PROVIDER_NAMES)[number];

export interface BenchmarkGateConfig {
  hit_at_5_improvement_pct: number;
  task_success_rate_improvement_pct: number;
  correction_turn_reduction_pct: number;
  prompt_token_increase_limit_pct: number;
  prompt_token_override_success_improvement_pct: number;
}

export interface BenchmarkEvalConfig {
  model_graded?: {
    enabled: boolean;
  };
}

export interface AdaptiveRetrievalConfig {
  enabled: boolean;
  thresholds?: {
    min_useful_chunks: number;
  };
}

export interface MetadataFiltersConfig {
  enabled: boolean;
}

export interface ActionRoutingConfig {
  enabled: boolean;
}

export interface RerankingConfig {
  enabled: boolean;
  backend: 'local' | 'cohere' | 'passthrough';
  model?: string;
  candidate_pool_size?: number;
  api_key?: string;
}

export interface IntelligenceConfig {
  rag_enabled: boolean;
  embedding_provider?: EmbeddingProviderName;
  embedding_model?: string;
  rag_similarity_threshold: number;
  rag_relief_floor: number;
  rag_top_n: number;
  rag_max_file_size?: number;
  existing_surface_tokens?: number;
  rag_base_branch?: string;
  benchmark_gates?: BenchmarkGateConfig;
  benchmark_eval?: BenchmarkEvalConfig;
  adaptive_retrieval?: AdaptiveRetrievalConfig;
  reranking?: RerankingConfig;
  metadata_filters?: MetadataFiltersConfig;
  action_routing?: ActionRoutingConfig;
}

export interface EfficiencyConfig {
  context_hit_rate_target?: number;
  skill_caching?: boolean;
  differential_refresh?: boolean;
  mcp_first?: boolean;
  predictive_cache?: boolean;
  auto_summarize_interval?: number;
  context_budget_strategy?: 'aggressive' | 'balanced' | 'conservative';
  summary_model_preference?: 'local' | 'cheapest' | 'default';
  auto_update?: boolean;
  minimum_version?: string;
  skip_version_check?: boolean;
  version_check_interval_hours?: number;
}

export interface EscalationConfig {
  destructive_operations: EscalationMode;
  risky_migrations: EscalationMode;
  security_findings: EscalationMode;
  db_row_threshold: number;
}

export interface CustomClassificationDimension {
  name: string;
  values?: string[];
  routing_effects?: string[];
}

export interface VerificationPluginConfig {
  name: string;
  entrypoint?: string;
  options?: Record<string, unknown>;
}

export interface EscalationRuleConfig {
  trigger: string;
  action: EscalationMode;
  rationale?: string;
}

export const DECISION_ASK_THRESHOLDS = ['strict', 'balanced', 'permissive'] as const;
export type DecisionAskThreshold = (typeof DECISION_ASK_THRESHOLDS)[number];

export interface DecisionProfileConfig {
  ask_threshold?: DecisionAskThreshold;
  max_screens_per_task?: number;
  max_pending?: number;
  idle_timeout_minutes?: number;
  ttl_overrides_days?: Partial<Record<string, number>>;
  preferred_option_keys?: Partial<Record<DecisionCategory, string>>;
}

export interface FlakyProfileConfig {
  rerun_count?: number;
}

export interface EnterpriseConfig {
  enabled: boolean;
  evidence_ledger: boolean;
  ai_bom: boolean;
  compliance_citations: boolean;
}

export interface PaqadConfig {
  enabled?: boolean;
}

export type ProjectTestingParallel = 'native' | 'available' | 'unavailable' | 'unknown';

export interface ProjectTesting {
  runner_id: string;
  parallel: ProjectTestingParallel;
  reason?: string;
  detected_by: 'script' | 'agent';
  lockfile_hash?: string;
  recorded_at: string;
}

export interface AppPreviewConfig {
  url: string;
  command?: string;
  wait_ms?: number;
}

export interface ProjectProfile {
  project: ProjectMetadata;
  active_capabilities: ActiveCapability[];
  paqad?: PaqadConfig;
  routing?: {
    domain: Domain;
    stack?: string;
    capabilities?: string[];
  };
  stack_profile?: DetectedStackProfile;
  commands: ProjectCommands;
  testing?: ProjectTesting;
  app_preview?: AppPreviewConfig;
  strictness: StrictnessConfig;
  compliance_packs: CompliancePackConfig[];
  features: ProjectFeatureFlags;
  enterprise?: EnterpriseConfig;
  mcp: {
    servers: ProjectMcpServer[];
  };
  model_routing: ModelRoutingConfig;
  research: {
    depth: ResearchDepth;
  };
  intelligence: IntelligenceConfig;
  efficiency: EfficiencyConfig;
  escalation: EscalationConfig;
  custom: {
    classification_dimensions: CustomClassificationDimension[];
    verification_plugins: VerificationPluginConfig[];
    escalation_rules: EscalationRuleConfig[];
    decisions?: DecisionProfileConfig;
    flaky?: FlakyProfileConfig;
  };
}
