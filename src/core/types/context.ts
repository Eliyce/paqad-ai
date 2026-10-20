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

export interface SummarisationMessage {
  role: 'user' | 'assistant';
  content: string;
  turn_id: string;
  decision_packet?: boolean;
  approval_turn?: boolean;
}

export interface SummariseSuccess {
  ok: true;
  summary_text: string;
  valid_through_turn_id: string;
  input_token_count: number;
  summary_token_count: number;
  truncated: boolean;
  preserved_turn_ids: string[];
}

export interface SummariseFailure {
  ok: false;
  error: 'inference-failed' | 'timeout' | 'cancelled';
}

export type SummariseResult = SummariseSuccess | SummariseFailure;

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

export interface ModelCatalogEntry {
  context_window_tokens: number;
  max_output_tokens?: number;
  tokenizer_version: string;
}

export type WorkspaceCompressionPolicy = 'standard' | 'aggressive' | 'conservative';

export type BudgetBand = 'comfortable' | 'tightening' | 'compressed' | 'force-summary';

export interface ComputeBudgetInput {
  system_prompt: string;
  project_knowledge: string;
  retrieved_chunks: string[];
  rolling_summary: string | null;
  recent_turns: string;
  new_user_message: string;
  reserved_output_tokens: number;
  model: ModelCatalogEntry;
  compression_policy: WorkspaceCompressionPolicy;
}

export interface CompressionAuditRecord {
  event: 'context.compression_applied';
  reason: 'chunk_exceeds_budget';
  dropped_chunk_count: number;
}

export interface BudgetBreakdownSuccess {
  ok: true;
  system_prompt_tokens: number;
  project_knowledge_tokens: number;
  retrieved_chunks_tokens: number;
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

export interface BudgetBreakdownError {
  ok: false;
  error: string;
  missing_field: 'context_window_tokens';
}

export type BudgetBreakdown = BudgetBreakdownSuccess | BudgetBreakdownError;

export type TurnPriority = 'high' | 'normal' | 'low';

export interface TurnInput {
  turn_id: string;
  text: string;
  decision_packet?: boolean;
  approval_turn?: boolean;
  priority?: TurnPriority;
}

export interface TaggedTurn extends TurnInput {
  priority: TurnPriority;
}

export interface ContextHealthWarning {
  type: 'context.context_health_warning';
  reason: 'priority_invariant_breach';
  turn_id: string;
  classifier_returned: TurnPriority;
  corrected_to: 'high';
}

export interface TurnTagResult {
  tagged: TaggedTurn[];
  warnings: ContextHealthWarning[];
}

export interface TurnTagPolicy {
  all_normal?: boolean;
}
