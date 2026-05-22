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
  signals: DetectionSignal[];
  timestamp: string;
  repository?: RepositoryContext;
}
