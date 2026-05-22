import type { BudgetTier, ContextSegmentPriority } from '../core/types/context.js';

export interface EvictionResult {
  evicted_count: number;
  tokens_reclaimed: number;
  evicted_sources: string[];
  evicted_segments: ContextSegmentPriority[];
  remaining_segments: ContextSegmentPriority[];
}

export class ContextEvictor {
  evict(segments: ContextSegmentPriority[], tier: BudgetTier): EvictionResult {
    const toEvict: ContextSegmentPriority[] = [];

    if (tier === 'yellow') {
      // Evict low priority only
      toEvict.push(...segments.filter((s) => s.tier === 'low'));
    } else if (tier === 'amber') {
      // Evict low + medium
      toEvict.push(...segments.filter((s) => s.tier === 'low' || s.tier === 'medium'));
    } else if (tier === 'red') {
      // Evict low + medium (compact flow handles the rest)
      toEvict.push(...segments.filter((s) => s.tier === 'low' || s.tier === 'medium'));
    }
    // green: nothing to evict

    const remaining_segments = segments.filter((segment) => !toEvict.includes(segment));
    const evicted_count = toEvict.length;
    const tokens_reclaimed = toEvict.reduce((sum, s) => sum + s.token_estimate, 0);
    const evicted_sources = toEvict.map((s) => s.content_type);

    return {
      evicted_count,
      tokens_reclaimed,
      evicted_sources,
      evicted_segments: toEvict,
      remaining_segments,
    };
  }
}
