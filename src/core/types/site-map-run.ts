export const SITE_MAP_WORKFLOWS = ['site-map', 'site-map-retest'] as const;
export type SiteMapWorkflowName = (typeof SITE_MAP_WORKFLOWS)[number];

export const SITE_MAP_SEVERITIES = ['high', 'medium', 'low'] as const;
export type SiteMapSeverity = (typeof SITE_MAP_SEVERITIES)[number];

export const SITE_MAP_VERDICTS = ['safe', 'attention', 'inconclusive'] as const;
export type SiteMapVerdict = (typeof SITE_MAP_VERDICTS)[number];

export const SITE_MAP_CATEGORIES = [
  'SM-ADD',
  'SM-EDGE-MISSING',
  'SM-REMOVE',
  'SM-EDGE-STALE',
  'SM-GUARD-DRIFT',
  'SM-JOURNEY-BROKEN',
  'SM-ORPHAN',
  'SM-DEADEND',
  'SM-EVIDENCE',
  'SM-XREF',
  'SM-GUARDLESS',
  'SM-TRUST',
] as const;
export type SiteMapCategory = (typeof SITE_MAP_CATEGORIES)[number];

export const SITE_MAP_TIERS = ['deterministic', 'ai-judged'] as const;
export type SiteMapTier = (typeof SITE_MAP_TIERS)[number];

export interface SiteMapBlockedCheck {
  check: string;
  reason: string;
  install_hint: string;
}

export const SITE_MAP_BASELINE_STATUSES = [
  'new-since-baseline',
  'pre-existing',
  'unknown',
] as const;
export type SiteMapBaselineStatus = (typeof SITE_MAP_BASELINE_STATUSES)[number];

export const SITE_MAP_FINDING_STATUSES = [
  'open',
  'fixed',
  'still-open',
  'needs-manual-verification',
] as const;
export type SiteMapFindingStatus = (typeof SITE_MAP_FINDING_STATUSES)[number];

export interface SiteMapFinding {
  id: string;
  title: string;
  description: string;
  category: SiteMapCategory;
  severity: SiteMapSeverity;
  tier: SiteMapTier;
  confidence: number;
  evidence: string[];
  resolution: string;
  affected_surfaces: string[];
  affected_files: string[];
  baseline_status: SiteMapBaselineStatus;
  status: SiteMapFindingStatus;
}

export interface SiteMapBaselineSummary {
  existed: boolean;
  new_since_baseline: number;
  pre_existing: number;
}

export interface SiteMapBaseline {
  schema_version: '1';
  generated_by: 'paqad-ai';
  framework_version: string;
  created_at: string;
  finding_ids: string[];
}

export interface SiteMapAppSummary {
  name: string;
  kind: string;
  frameworks: string[];
}

export interface SiteMapInventory {
  screens: number;
  groups: string[];
  guards: number;
}

export interface SiteMapExtractionSummary {
  extractors_ran: number;
  extracted_surfaces: number;
  low_confidence_fallback: boolean;
  fingerprint: string;
}

export interface SiteMapReportIndex {
  schema_version: '1';
  generated_by: 'paqad-ai';
  framework_version: string;
  report_id: string;
  workflow: SiteMapWorkflowName;
  generated_at: string;
  bundle_dir: string;
  app: SiteMapAppSummary;
  surface_count: number;
  journey_count: number;
  extraction: SiteMapExtractionSummary;
  findings: SiteMapFinding[];
  blocked_checks: SiteMapBlockedCheck[];
  baseline: SiteMapBaselineSummary;
  sources_used: string[];
}
