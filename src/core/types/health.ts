import type { ActiveCapability, Capability, Domain, Stack } from './domain.js';
import type { RepositoryContext } from './repository.js';

export const HEALTH_CHECK_STATUSES = ['pass', 'fail', 'warning'] as const;
export type HealthCheckStatus = (typeof HEALTH_CHECK_STATUSES)[number];

export interface HealthCheckResult {
  name: string;
  status: HealthCheckStatus;
  detail: string;
  remediation?: string;
}

export interface HealthEfficiencySummary {
  context_hit_rate: number;
  skill_cache_hit_rate: number;
  mcp_usage_rate: number;
}

export interface HealthReport {
  overall_status: HealthCheckStatus;
  checks: HealthCheckResult[];
  efficiency: HealthEfficiencySummary;
}

export interface DetectionSignal {
  signal: string;
  file: string;
  implies: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface DetectionReport {
  detected_domain: Domain | null;
  detected_stack: Stack | null;
  detected_capabilities: Capability[];
  matched_packs?: string[];
  detected_traits?: string[];
  recommended_capabilities?: ActiveCapability[];
  detection_phase?: 'framework' | 'archetype' | 'none';
  confidence: 'high' | 'medium' | 'low';
  /**
   * PQD-423: numeric confidence in the inclusive range `[0, 1]`. Coexists with the
   * categorical `confidence` field (which the six internal callers still read) — it is
   * an additive surface for consumers that want a continuous score (e.g. `0.92`).
   */
  confidence_score?: number;
  /**
   * PQD-423: human-readable primary language derived from the primary toolchain
   * ecosystem (e.g. `'JavaScript/TypeScript'`, `'Python'`). `null` when no code
   * ecosystem was detected (empty, unknown, or content-only projects).
   */
  primary_language?: string | null;
  /**
   * PQD-423: which detection path produced this report — `'ai'` when the AI-first
   * path returned a confident result, `'static'` when the rule-based fallback ran.
   */
  source?: 'ai' | 'static';
  signals: DetectionSignal[];
  timestamp: string;
  repository?: RepositoryContext;
}
