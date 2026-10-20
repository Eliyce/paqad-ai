import type { EnvelopeHeader } from './envelope.js';
import type { PlanReuse } from './reuse.js';

export const FEATURE_DOC_TYPE = 'paqad.feature';

export const PLAN_DOC_TYPE = 'paqad.plan';

export const REVIEW_DOC_TYPE = 'paqad.review';

export const SPECIFICATION_DOC_TYPE = 'paqad.specification';

export const SPEC_SOURCE_DOC_TYPE = 'paqad.spec';

export const REQUEST_DOC_TYPE = 'paqad.request';

export const CLARIFICATION_DOC_TYPE = 'paqad.clarification';

export const EXPERTS_DOC_TYPE = 'paqad.experts';

export const DECISIONS_DOC_TYPE = 'paqad.decisions';
export const TECH_DEBT_DOC_TYPE = 'paqad.tech-debt';
export const RULE_OVERRIDE_DOC_TYPE = 'paqad.rule-override';

export const FEATURE_SESSION_DOC_TYPE = 'paqad.feature-session';

export const FEATURE_EVIDENCE_SCHEMA_VERSION = 1;

export const FEATURE_DOC_SCHEMA_VERSION = 2;

export type FeatureLane = 'fast' | 'graduated' | 'full' | null;

export type FeatureStatus = 'active' | 'paused' | 'done' | 'spec-only';

export interface FeatureRecord extends EnvelopeHeader {
  doc_type: typeof FEATURE_DOC_TYPE;
  issue: string | null;
  title: string;
  slug: string;
  updated_at: string;
  lane: FeatureLane;
  status: FeatureStatus;
  spec_id: string | null;
  adapter: string;
  branch?: string | null;
  base_branch?: string | null;
}

export interface LegacyFeatureRecord {
  schema_version: 1;
  doc_type: typeof FEATURE_DOC_TYPE;
  issue: string | null;
  title: string;
  slug: string;
  ulid: string;
  created_at: string;
  updated_at: string;
  lane: FeatureLane;
  status: FeatureStatus;
  spec_id: string | null;
  session_first_seen: string;
  adapter: string;
  branch?: string | null;
  base_branch?: string | null;
  content_hash: string;
}

export type PlanStepClassification =
  'ac-satisfying' | 'necessary-setup' | 'scaffolding' | 'over-build';

export interface PlanStep {
  id: string;
  description: string;
  module?: string;
  classification?: PlanStepClassification;
  files?: string[];
}

export interface PlanRisk {
  description: string;
  mitigation: string;
}

export interface PlanRecord extends EnvelopeHeader {
  doc_type: typeof PLAN_DOC_TYPE;
  summary: string;
  steps: PlanStep[];
  modules_touched: string[];
  decisions: string[];
  risks: PlanRisk[];
  reuse?: PlanReuse;
}

export type ReviewVerdict = 'safe-to-merge' | 'needs-attention' | 'inconclusive';

export type ReviewFindingSeverity = 'blocker' | 'major' | 'minor';

export interface ReviewFinding {
  severity: ReviewFindingSeverity;
  description: string;
  file?: string;
  deferred_to?: string;
}

export interface ReviewRecord extends EnvelopeHeader {
  doc_type: typeof REVIEW_DOC_TYPE;
  summary: string;
  verdict: ReviewVerdict;
  findings: ReviewFinding[];
  checked: string[];
  rollback: string;
}

export interface FeatureSessionControl {
  schema_version: number;
  doc_type: typeof FEATURE_SESSION_DOC_TYPE;
  session_id: string;
  active: string | null;
  paused: string[];
  lane: FeatureLane;
  updated_at: string;
  written_by?: string | null;
  pid?: number;
}

export interface FeatureDirName {
  issue: string | null;
  slug: string;
  ulid: string;
}
