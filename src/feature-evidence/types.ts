import type { PlanReuse } from './reuse.js';

// Per-feature evidence bundle types (issue #339, Phase 1 — dark foundation).
//
// The design: each feature gets ONE directory
// `.paqad/ledger/feature-evidence/<issue>-<slug>-<ULID>/` that is its whole
// workflow record plus its compliance bundle — plan, spec, stage evidence, rule
// run, delivery/git linkage, receipt, AI-BOM slice, and the retrieval that served
// it — all rigid, script-owned JSON. Phase 1 lays the dark foundation: the path
// layer, the `feature.json` / `plan.json` schemas (spec reuses the existing
// `FeatureSpec` shape), and the per-session active + paused control. Nothing is
// wired into the live recorder yet, so the feature-development stage spine is
// untouched.

/** Doc type stamped on a `feature.json` record. */
export const FEATURE_DOC_TYPE = 'paqad.feature';

/** Doc type stamped on a `plan.json` record. */
export const PLAN_DOC_TYPE = 'paqad.plan';

/** Doc type stamped on a `review.json` record. */
export const REVIEW_DOC_TYPE = 'paqad.review';

/** Doc type stamped on the `_session/<sessionId>.json` control. */
export const FEATURE_SESSION_DOC_TYPE = 'paqad.feature-session';

/** Schema version for the Phase-1 per-feature records. */
export const FEATURE_EVIDENCE_SCHEMA_VERSION = 1;

/** The lane a feature was routed to; `null` when the classifier picked none. */
export type FeatureLane = 'fast' | 'graduated' | 'full' | null;

/** A feature's lifecycle status within its session control. */
export type FeatureStatus = 'active' | 'paused' | 'done';

/**
 * The identity + status record stored as `feature.json`. Rigid and script-owned:
 * the AJV schema rejects unknown keys, and `content_hash` is a SHA-256 over the
 * identity fields (volatile timestamps excluded) so a hand-edit is detectable.
 */
export interface FeatureRecord {
  schema_version: number;
  doc_type: typeof FEATURE_DOC_TYPE;
  /** Verbatim ticket/issue ref (`339`, `PQD-123`), or null when none was detected. */
  issue: string | null;
  title: string;
  slug: string;
  /** The 26-char ULID minted at feature birth; the dir name's stable tail. */
  ulid: string;
  created_at: string;
  updated_at: string;
  lane: FeatureLane;
  status: FeatureStatus;
  /** The frozen spec id this feature's `specification.json` carries, or null. */
  spec_id: string | null;
  /** The session that first opened this feature (provenance). */
  session_first_seen: string;
  adapter: string;
  content_hash: string;
}

/**
 * The diff-minimizer verdict for a plan step (issue #359): does it satisfy an acceptance
 * criterion, set up one that does, or is it scaffolding / over-build that should be dropped?
 * Mirrors the skill's `assets/classifications.txt` so a recorded plan can carry the verdict.
 */
export type PlanStepClassification =
  'ac-satisfying' | 'necessary-setup' | 'scaffolding' | 'over-build';

/** One step in a plan's implementation sequence. */
export interface PlanStep {
  id: string;
  description: string;
  /** Module slug this step touches, when known. */
  module?: string;
  /** The diff-minimizer classification for this step (issue #359), when the skill ran. */
  classification?: PlanStepClassification;
}

/** A risk the plan surfaced, paired with its mitigation. */
export interface PlanRisk {
  description: string;
  mitigation: string;
}

/**
 * The planning artifact stored as `plan.json`. Carries the feature identity plus
 * the structured plan. Rigid and script-owned (the AJV schema rejects unknown
 * keys); replaces the free-written `.paqad/plans/<change>.md` hallucination
 * surface in the later plan-compile phase.
 */
export interface PlanRecord {
  schema_version: number;
  doc_type: typeof PLAN_DOC_TYPE;
  issue: string | null;
  title: string;
  slug: string;
  ulid: string;
  summary: string;
  steps: PlanStep[];
  /** Module slugs the change touches. */
  modules_touched: string[];
  /** Decision-packet ids (`D-…`) this plan depends on. */
  decisions: string[];
  risks: PlanRisk[];
  /**
   * What the plan checked before deciding to build (issue #357). Optional on the stored
   * record so a `plan.json` written before the reuse gate stays readable; every plan
   * compiled since carries it, because the compile verb refuses an input without one.
   */
  reuse?: PlanReuse;
  created_at: string;
  updated_at: string;
  content_hash: string;
}

/** The verdict a review reached, in the paqad narration contract's own words. */
export type ReviewVerdict = 'safe-to-merge' | 'needs-attention' | 'inconclusive';

/** How serious a review finding is; a `blocker` is what `review_findings: stop` escalates. */
export type ReviewFindingSeverity = 'blocker' | 'major' | 'minor';

/** One thing the review found, and where. */
export interface ReviewFinding {
  severity: ReviewFindingSeverity;
  description: string;
  /** Project-relative file the finding sits in, when it has one. */
  file?: string;
}

/**
 * The review artifact stored as `review.json` (issue #402). Before this, `review`
 * owned no rigid bundle file, so its evidence was an agent-authored `.md` written
 * wherever the model chose — including inside the bundle dir, which is meant to hold
 * only rigid, script-owned artifacts. This gives the stage the same contract
 * `plan.json` has: the model fills a template, the script builds and hashes the
 * record, and the AJV schema rejects unknown keys.
 */
export interface ReviewRecord {
  schema_version: number;
  doc_type: typeof REVIEW_DOC_TYPE;
  issue: string | null;
  title: string;
  slug: string;
  ulid: string;
  summary: string;
  verdict: ReviewVerdict;
  findings: ReviewFinding[];
  /** What the review actually looked at (RULE-14's priority list: correctness, regressions, …). */
  checked: string[];
  /** How to undo the change, which the code-review rule requires the review to state. */
  rollback: string;
  created_at: string;
  updated_at: string;
  content_hash: string;
}

/**
 * The per-session control (`_session/<sessionId>.json`): one active feature plus
 * a paused-feature stack and the pending lane. Folds today's `.open` +
 * `.pending-lane` role at feature grain. Values are feature dir names (the change
 * key). `paused` is a stack — most-recently-paused last — so a resume pops the
 * end.
 */
export interface FeatureSessionControl {
  schema_version: number;
  doc_type: typeof FEATURE_SESSION_DOC_TYPE;
  session_id: string;
  /** The active feature dir name, or null when none is active. */
  active: string | null;
  /** Paused feature dir names, most-recently-paused last. */
  paused: string[];
  lane: FeatureLane;
  updated_at: string;
}

/** The `{ issue, slug, ulid }` parsed out of a feature dir name. */
export interface FeatureDirName {
  issue: string | null;
  slug: string;
  ulid: string;
}
