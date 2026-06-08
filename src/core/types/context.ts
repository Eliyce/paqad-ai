export const CONTEXT_LEVELS = [0, 1, 2, 3, 4] as const;
export type ContextLevel = (typeof CONTEXT_LEVELS)[number];

export interface ContextHitEntry {
  session_id: string;
  phase: string;
  story?: string;
  files_loaded: number;
  files_referenced: number;
  hit_rate: number;
  unreferenced_files: string[];
  timestamp: string;
}

export interface ContextBudgetConfig {
  config_tokens: number;
  skills_per_session: number;
  main_agent_max: number;
  compaction_trigger_pct: number;
}

export interface SkillCacheEntry {
  skill_name: string;
  input_hash: string;
  result: unknown;
  created_at: string;
  files_hashed: string[];
}

export type ContextHitLog = ContextHitEntry;
export type ContextBudget = ContextBudgetConfig;

// For Feature 3 / QW-4 (Context Budget Optimizer + Summarization Hooks)
export type BudgetTier = 'green' | 'yellow' | 'amber' | 'red';

export interface ContextSegmentPriority {
  tier: 'critical' | 'high' | 'medium' | 'low';
  content_type: string;
  token_estimate: number;
}

export interface SummarizedTurn {
  turn_index: number;
  timestamp: string;
  decisions: string[];
  files_touched: string[];
  blockers: string[];
  next_steps: string[];
  original_tokens: number;
  summary_tokens: number;
}

export interface BudgetOptimizerState {
  tier: BudgetTier;
  tokens_used: number;
  max_tokens: number;
  last_evaluated_at: string;
  summarized_turn_count: number;
  evicted_segment_count: number;
  recommended_action?: 'continue' | 'warn' | 'compact';
  enforcement_reason?: 'healthy' | 'token-budget-tight' | 'context-hit-rate-below-target';
}

export interface ContextSavingsEntry {
  session_id: string;
  timestamp: string;
  summarization_savings: number;
  eviction_savings: number;
  dedup_savings: number;
}

export interface DeduplicationStats {
  total_artifacts: number;
  deduplicated: number;
  tokens_saved_estimate: number;
}

// ── PQD-167: per-turn context budget breakdown ──────────────────────────────
//
// The desktop renders a faithful budget indicator and the optimizer decides
// whether to compress, both from a single token-by-token breakdown of how the
// active model's context window is consumed. These types describe the call's
// input and result; the computation lives in `ContextBudgetEnforcer.computeBudget`.

/**
 * Minimal model-catalog shape needed to size a context window. Aligns with the
 * desktop's `ModelMeta.contextWindowTokens` (spec 106) so the two repos agree on
 * the field name when they integrate.
 *
 * @since 1.10.0
 */
export interface ModelCatalogEntry {
  /** Total tokens the model's context window can hold. */
  context_window_tokens: number;
  /** Maximum tokens the model may emit; caps `reserved_output_tokens` when set. */
  max_output_tokens?: number;
  /** Tokenizer identifier; selects (and is reported by) the tokenizer used. */
  tokenizer_version: string;
}

/**
 * Workspace `context_compression_aggression` policy. Separate from the
 * optimizer's `BudgetOptimizerConfig.strategy` (which uses `balanced`): the two
 * remain intentionally distinct so neither change drags the other.
 *
 * @since 1.10.0
 */
export type WorkspaceCompressionPolicy = 'standard' | 'aggressive' | 'conservative';

/**
 * Usage band the breakdown falls into, derived from the active compression
 * policy's thresholds. Distinct from `BudgetTier` (`green/yellow/amber/red`).
 *
 * @since 1.10.0
 */
export type BudgetBand = 'comfortable' | 'tightening' | 'compressed' | 'force-summary';

/**
 * Fully-assembled per-turn context slices plus the active model and policy.
 * Slices are raw strings; the engine tokenizes them.
 *
 * @since 1.10.0
 */
export interface ComputeBudgetInput {
  system_prompt: string;
  project_knowledge: string;
  retrieved_chunks: string[];
  /** `null` when no rolling summary exists yet. */
  rolling_summary: string | null;
  recent_turns: string;
  new_user_message: string;
  /** Requested reserved output tokens; capped to `model.max_output_tokens`. */
  reserved_output_tokens: number;
  model: ModelCatalogEntry;
  compression_policy: WorkspaceCompressionPolicy;
}

/**
 * Audit record attached when one or more retrieved chunks were dropped because
 * a single chunk's token cost exceeded the remaining available budget.
 *
 * @since 1.10.0
 */
export interface CompressionAuditRecord {
  event: 'context.compression_applied';
  reason: 'chunk_exceeds_budget';
  dropped_chunk_count: number;
}

/**
 * Successful budget breakdown: every slice's token cost, the total, the
 * percentage of the active window in use, and the band.
 *
 * @since 1.10.0
 */
export interface BudgetBreakdownSuccess {
  ok: true;
  system_prompt_tokens: number;
  project_knowledge_tokens: number;
  retrieved_chunks_tokens: number;
  /** `"—"` sentinel when no rolling summary exists yet (see `ComputeBudgetInput`). */
  rolling_summary_tokens: number | '—';
  recent_turns_tokens: number;
  new_user_message_tokens: number;
  reserved_output_tokens: number;
  total_used: number;
  usage_pct: number;
  band: BudgetBand;
  tokenizer_version: string;
  dropped_chunk_count: number;
  compression_audit?: CompressionAuditRecord;
}

/**
 * Error breakdown returned when the model catalog entry has no
 * `context_window_tokens`; no default window is ever substituted.
 *
 * @since 1.10.0
 */
export interface BudgetBreakdownError {
  ok: false;
  error: string;
  missing_field: 'context_window_tokens';
}

/**
 * Discriminated union on `ok` returned by `ContextBudgetEnforcer.computeBudget`.
 *
 * @since 1.10.0
 */
export type BudgetBreakdown = BudgetBreakdownSuccess | BudgetBreakdownError;
