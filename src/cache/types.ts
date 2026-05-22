export interface TransitionEntry {
  timestamp: string;
  workflow: string;
  stack_key: string;
  from_skill: string;
  to_skill: string;
  from_outputs_hash: string;
}

export interface TransitionLog {
  version: 1;
  entries: Record<string, TransitionEntry[]>; // keyed by stack_key
  max_entries_per_key: number;
}

export interface CacheMetrics {
  session_id: string;
  cache_hits: number;
  cache_misses: number;
  prewarm_hits: number;
  prewarm_misses: number;
  prewarm_skipped: number;
  total_token_savings_estimate: number;
}
