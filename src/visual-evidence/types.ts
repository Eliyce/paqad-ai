// Visual-evidence manifest types + closed vocabularies (issue #551).
//
// The manifest (`visual-evidence.json`) is the rigid, script-written record of one capture
// run. These types are the single source of truth for its shape; the AJV schema in
// `src/feature-evidence/schema.ts` reuses the const arrays below so the runtime type and the
// validated shape can never drift.

export const VISUAL_EVIDENCE_DOC_TYPE = 'paqad.visual-evidence';
export const VISUAL_EVIDENCE_SCHEMA_VERSION = 1;

/** Closed set of reasons a capture step or the whole run was skipped. */
export const VE_SKIP_REASONS = [
  'not-frontend',
  'flag-off',
  'no-documented-flow',
  'no-capture-script',
  'capture-script-invalid',
  'playwright-not-provisioned',
  'app-preview-not-configured',
  'app-not-reachable',
  'env-var-missing',
  'selector-not-found',
] as const;
export type VeSkipReason = (typeof VE_SKIP_REASONS)[number];

/** Per-step outcome. */
export const VE_STEP_STATUSES = ['captured', 'failed', 'skipped'] as const;
export type VeStepStatus = (typeof VE_STEP_STATUSES)[number];

/** Overall run outcome. */
export const VE_RESULTS = ['captured', 'partial', 'skipped'] as const;
export type VeResult = (typeof VE_RESULTS)[number];

/** How a changed file tied a planned flow to the change. */
export interface VeMatchedBy {
  file: string;
  surface: string;
  module: string;
}

/** One planned capture (a confirmed journey + its capture script). */
export interface VePlanEntry {
  journey_id: string;
  capture_script: string;
  matched_by: VeMatchedBy[];
}

/** One captured/failed/skipped step in the manifest. */
export interface VeStep {
  index: number;
  journey_id: string;
  journey_step: number;
  caption: string;
  dir: string;
  route?: string;
  captured_at: string;
  image_sha256?: string;
  image_bytes?: number;
  status: VeStepStatus;
  failure?: string;
}

/** The overview GIF descriptor, or null when no frame was captured. */
export interface VeGif {
  file: string;
  frames: number;
  frame_ms: number;
  sha256: string;
  bytes: number;
}

/** A recorded skip (documented or environmental). */
export interface VeSkip {
  reason: VeSkipReason;
  detail: string;
}

/** What triggered the run (or would have). */
export interface VeTrigger {
  changed_files: string[];
  matched_globs: string[];
  packs: string[];
}

/** The rigid manifest written by the runner and read by the gate + report. */
export interface VisualEvidenceManifest {
  schema_version: number;
  doc_type: typeof VISUAL_EVIDENCE_DOC_TYPE;
  generated_at: string;
  content_hash: string;
  trigger: VeTrigger;
  plan: VePlanEntry[];
  steps: VeStep[];
  gif: VeGif | null;
  skips: VeSkip[];
  result: VeResult;
}
