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
