import type { EnvelopeHeader } from '@/feature-evidence/envelope.js';

export const VISUAL_EVIDENCE_DOC_TYPE = 'paqad.visual-evidence';
export const VISUAL_EVIDENCE_SCHEMA_VERSION = 2;

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

export const VE_STEP_STATUSES = ['captured', 'failed', 'skipped'] as const;
export type VeStepStatus = (typeof VE_STEP_STATUSES)[number];

export const VE_RESULTS = ['captured', 'partial', 'skipped'] as const;
export type VeResult = (typeof VE_RESULTS)[number];

export const VE_SOURCES = ['agent-attached', 'mixed'] as const;
export type VeSource = (typeof VE_SOURCES)[number];

export const AGENT_ATTACHED_JOURNEY = 'agent-attached';

export interface VeMatchedBy {
  file: string;
  surface: string;
  module: string;
}

export interface VePlanEntry {
  journey_id: string;
  capture_script: string;
  matched_by: VeMatchedBy[];
}

export interface VeStep {
  index: number;
  journey_id: string;
  journey_step: number;
  caption: string;
  dir: string;
  route?: string;
  recorded_at: string;
  image_sha256?: string;
  image_bytes?: number;
  status: VeStepStatus;
  failure?: string;
  ac?: string;
}

export interface VeGif {
  file: string;
  frames: number;
  frame_ms: number;
  sha256: string;
  bytes: number;
}

export interface VeSkip {
  reason: VeSkipReason;
  detail: string;
}

export interface VeTrigger {
  changed_files: string[];
  matched_globs: string[];
  packs: string[];
}

export interface VisualEvidenceManifest extends EnvelopeHeader {
  doc_type: typeof VISUAL_EVIDENCE_DOC_TYPE;
  trigger: VeTrigger;
  plan: VePlanEntry[];
  steps: VeStep[];
  gif: VeGif | null;
  skips: VeSkip[];
  result: VeResult;
  source?: VeSource;
}
