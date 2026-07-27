// Site-map run types — findings, the baseline ratchet, and run status. Deliberately
// separate from the map-document types in `site-map.ts` (Surface/Journey/etc.): those
// describe the artifact the run produces, these describe the audit OF that artifact.
// Modelled on the codebase-health finding/retest/baseline shapes so retest, the SIEM
// fold, and the baseline ratchet all behave identically. See
// docs/specs/site-map-capability.plan.md §II.4.

export const SITE_MAP_WORKFLOWS = ['site-map', 'site-map-retest'] as const;
export type SiteMapWorkflowName = (typeof SITE_MAP_WORKFLOWS)[number];

export const SITE_MAP_SEVERITIES = ['high', 'medium', 'low'] as const;
export type SiteMapSeverity = (typeof SITE_MAP_SEVERITIES)[number];

/**
 * The finding categories for the deterministic core. Each is the `category` field value,
 * never the finding id (the id is a content-addressed `SM-<hash8>`). The i18n (`SM-I18N-*`)
 * and flag-debt (`SM-FLAG-*`) families from the addendum are deferred to a later phase.
 */
export const SITE_MAP_CATEGORIES = [
  'SM-ADD', // surface exists in code, missing from the map
  'SM-REMOVE', // mapped surface no longer in code
  'SM-EDGE-STALE', // a transition's evidence no longer matches
  'SM-GUARD-DRIFT', // a guard changed (e.g. middleware removed) — security-relevant
  'SM-JOURNEY-BROKEN', // a journey step references a removed surface/transition
  'SM-ORPHAN', // surface unreachable from any entry
  'SM-DEADEND', // non-terminal surface with no outgoing transition
  'SM-EVIDENCE', // a cited file:line does not resolve (Tier-A)
  'SM-XREF', // a transition target or guard reference does not exist (Tier-A)
  'SM-GUARDLESS', // a sensitive surface has no guard
] as const;
export type SiteMapCategory = (typeof SITE_MAP_CATEGORIES)[number];

/** Whether a finding was mechanically proven or is a candidate the AI must judge. */
export const SITE_MAP_TIERS = ['deterministic', 'ai-judged'] as const;
export type SiteMapTier = (typeof SITE_MAP_TIERS)[number];

/**
 * A check the run could not perform, with why and how to enable it (FR-3). An unavailable
 * extractor becomes one of these and the run proceeds — a blocked check is a gap, never a
 * silent pass. Mirrors `HealthBlockedCheck`.
 */
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

export const SITE_MAP_RETEST_STATUSES = [
  'fixed',
  'still-open',
  'needs-manual-verification',
] as const;
export type SiteMapRetestStatus = (typeof SITE_MAP_RETEST_STATUSES)[number];

export const SITE_MAP_FINDING_STATUSES = [
  'open',
  'fixed',
  'still-open',
  'needs-manual-verification',
] as const;
export type SiteMapFindingStatus = (typeof SITE_MAP_FINDING_STATUSES)[number];

/** A single defect in the behavioural map. Its identity is content-addressed (`SM-<hash8>`). */
export interface SiteMapFinding {
  id: string;
  title: string;
  /** The reason it matters, in plain words. */
  description: string;
  category: SiteMapCategory;
  severity: SiteMapSeverity;
  tier: SiteMapTier;
  /** 0..1 — deterministic findings sit high; ai-judged carry the model's grade. */
  confidence: number;
  /** Proof: source + a machine-readable location (surface id, file:line). */
  evidence: string[];
  /** A concrete fix — "Review this" is not a fix (the house rule). */
  resolution: string;
  affected_surfaces: string[];
  affected_files: string[];
  baseline_status: SiteMapBaselineStatus;
  status: SiteMapFindingStatus;
}

export interface SiteMapRetestFinding extends SiteMapFinding {
  retest_status: SiteMapRetestStatus;
}

export interface SiteMapBaselineSummary {
  existed: boolean;
  new_since_baseline: number;
  pre_existing: number;
}

/** Persisted first-run fingerprint set that powers the new-vs-pre-existing ratchet. */
export interface SiteMapBaseline {
  schema_version: '1';
  generated_by: 'paqad-ai';
  framework_version: string;
  created_at: string;
  finding_ids: string[];
}

/** The mapped product, distilled for the run header (mirrors health's `stack`). */
export interface SiteMapAppSummary {
  name: string;
  /** The primary app kind (the first of a multi-kind app). */
  kind: string;
  frameworks: string[];
}

/** What the extraction stage produced, distilled for the run header and the freshness gate. */
export interface SiteMapExtractionSummary {
  extractors_ran: number;
  extracted_surfaces: number;
  low_confidence_fallback: boolean;
  /** Content-addressed over the raw surface set — the drift signal the freshness gate compares. */
  fingerprint: string;
}

/**
 * The dual-written run report (`docs/site-map/<ts>.json` sidecar). Mirrors `HealthReportIndex`:
 * a self-describing, schema-versioned record of one audit — its findings, what was blocked, the
 * baseline delta — so `paqad-ai audit export` and the retest bookend read a stable shape.
 */
export interface SiteMapReportIndex {
  schema_version: '1';
  generated_by: 'paqad-ai';
  framework_version: string;
  report_id: string;
  workflow: SiteMapWorkflowName;
  generated_at: string;
  /** Repo-relative posix path of the human markdown report. */
  report_path: string;
  /** Repo-relative posix path of this JSON sidecar. */
  sidecar_path: string;
  /** Repo-relative posix path of the run's evidence bundle directory. */
  bundle_dir: string;
  source_report_path: string | null;
  source_report_id: string | null;
  app: SiteMapAppSummary;
  /** Surfaces in the CANONICAL map (`app-map.yaml`); 0 when no map exists yet. */
  surface_count: number;
  journey_count: number;
  extraction: SiteMapExtractionSummary;
  findings: Array<SiteMapFinding | SiteMapRetestFinding>;
  blocked_checks: SiteMapBlockedCheck[];
  baseline: SiteMapBaselineSummary;
  sources_used: string[];
  next_remediation_priorities: string[];
}
