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
}

export const TICKET_PROVIDER_KINDS = ['jira', 'linear', 'github-issues', 'generic'] as const;
export type TicketProviderKind = (typeof TICKET_PROVIDER_KINDS)[number];

export interface ProjectMcpServer {
  name: string;
  enabled: boolean;
  /**
   * Optional discriminator used by ticket_intake / delivery to pick the right
   * server. Existing servers without `kind` continue to validate.
   */
  kind?: TicketProviderKind;
  config?: Record<string, unknown>;
}

// Shared enums consumed by the delivery-policy (issue #42). The delivery
// conventions themselves now live in `docs/instructions/workflows/delivery-policy.yaml`
// (see `src/core/types/delivery-policy.ts`), not in the project profile.
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
  rag_top_n: number;
  rag_max_file_size?: number;
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
  /** Model tier preference for rolling-summary inference (PQD-169). @since 1.10.0 */
  summary_model_preference?: 'local' | 'cheapest' | 'default';
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
  /** PQD-101 — per-project cap on simultaneously pending decision packets. */
  max_pending?: number;
  idle_timeout_minutes?: number;
  ttl_overrides_days?: Partial<Record<string, number>>;
  preferred_option_keys?: Partial<Record<DecisionCategory, string>>;
}

// Issue #106 — flaky-test handling. Re-run count is project-tunable so a slow
// suite can keep stability re-runs cheap; clamped to a sane band at read time.
export interface FlakyProfileConfig {
  rerun_count?: number;
}

// Issue #187 — enterprise/governance capabilities are opt-in and off by default.
// The `enterprise` block is the config seam for the licensed evidence-ledger
// feature. `enabled` is the master switch; when false (or the block is absent),
// every sub-flag is forced off regardless of its value. A normal user pays zero
// tokens and gets a clean working tree (no `.paqad/ledger/` writes). A future
// license/token check slots in behind `resolveEnterprisePolicy`, so callers
// never learn about billing — see `src/core/enterprise-policy.ts`.
export interface EnterpriseConfig {
  /** Master switch. When false, every sub-flag below is forced off. */
  enabled: boolean;
  /** Write the receipt + ledger set: `evidence.jsonl`, `receipts.jsonl`, `receipt.dsse.json`. */
  evidence_ledger: boolean;
  /** Write the CycloneDX `ai-bom.json` view. Independent of `evidence_ledger`. */
  ai_bom: boolean;
  /** Resolve framework citations into the receipt (the token-spending path). */
  compliance_citations: boolean;
}

export interface ProjectProfile {
  project: ProjectMetadata;
  active_capabilities: ActiveCapability[];
  routing?: {
    domain: Domain;
    stack?: string;
    capabilities?: string[];
  };
  stack_profile?: DetectedStackProfile;
  commands: ProjectCommands;
  strictness: StrictnessConfig;
  compliance_packs: CompliancePackConfig[];
  features: ProjectFeatureFlags;
  /** Issue #187 — opt-in enterprise capabilities. Absent ⇒ everything off. */
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
