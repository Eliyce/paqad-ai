// Per-feature rigid artifact writers (issue #339, Phase 3): plan.json + specification.json.
//
// These replace the free-written `.paqad/plans/<change>.md` (a hallucination surface)
// and co-locate the frozen spec inside the feature bundle. The model never owns the
// stored bytes: `plan.json` is compiled from a fixed template into a schema-validated
// `PlanRecord` with a deterministic `content_hash`; `specification.json` stores the
// already-script-built frozen `FeatureSpec` (its `spec_hash` + freeze metadata are the
// proof). Both are written into the ACTIVE feature's dir — the change key resolved from
// the `_session` control — so a plan/spec is always attached to a real feature, never to
// a session ordinal. Writes are atomic (temp + rename); readers tolerate a missing or
// corrupt file.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { FeatureSpec } from '@/core/types/feature-spec.js';

import { buildPlanRecord, buildReviewRecord } from './mint.js';
import { parseFeatureDirName, featureFilePath } from './paths.js';
import { backfillFeatureSlug } from './rename.js';
import { validatePlanRecord, validateReviewRecord } from './schema.js';
import { currentFeature } from './stage-ledger.js';
import type {
  PlanRecord,
  PlanRisk,
  PlanStep,
  ReviewFinding,
  ReviewRecord,
  ReviewVerdict,
} from './types.js';

/** The slots a plan template exposes for the model to fill (identity comes from the dir). */
export interface PlanCompileInput {
  summary: string;
  steps?: PlanStep[];
  modules_touched?: string[];
  decisions?: string[];
  risks?: PlanRisk[];
  /** Title override for the record; defaults to the feature slug when absent. */
  title?: string;
  now?: () => Date;
}

/** Thrown when a compile verb runs with no active feature to attach the artifact to. */
export class NoActiveFeatureError extends Error {
  constructor() {
    super('No active feature — run `paqad-ai stage start planning` first.');
    this.name = 'NoActiveFeatureError';
  }
}

function atomicWriteJson(absPath: string, value: unknown): void {
  mkdirSync(dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tmp, absPath);
}

function readJson<T>(absPath: string): T | null {
  try {
    return JSON.parse(readFileSync(absPath, 'utf8')) as T;
  } catch {
    return null;
  }
}

export interface CompiledArtifact<T> {
  dirName: string;
  path: string;
  record: T;
}

/**
 * The active feature's dir name plus its parsed `{ issue, slug, ulid }`. Every rigid
 * artifact takes its identity from the dir name (never from the model), so both compile
 * verbs resolve it the same way through this one helper.
 */
function activeFeatureParts(projectRoot: string, sessionId: string) {
  const dirName = currentFeature(projectRoot, sessionId);
  if (!dirName) {
    throw new NoActiveFeatureError();
  }
  const parts = parseFeatureDirName(dirName);
  if (!parts) {
    throw new Error(`Active feature dir name is not parseable: ${JSON.stringify(dirName)}`);
  }
  return { dirName, parts };
}

/**
 * Compile the active feature's `plan.json` from a filled template. The record's identity
 * (issue / slug / ulid) is taken from the feature dir name so the plan can never drift
 * from the feature it belongs to; the model supplies only the plan body. When the
 * template carries a `title` and the active dir still has the generic untitled
 * `change-<ULID>` shape, the bundle is first renamed to the descriptive
 * `[<issue>-]<slug>-<ULID>` (issue #403) so the recorded slug is never the literal
 * `change`. Validates against `PLAN_SCHEMA` and throws on any violation, so a malformed
 * template is never persisted. Throws {@link NoActiveFeatureError} when no feature is
 * active.
 */
export function writeFeaturePlan(
  projectRoot: string,
  sessionId: string,
  input: PlanCompileInput,
): CompiledArtifact<PlanRecord> {
  let { dirName, parts } = activeFeatureParts(projectRoot, sessionId);
  if (input.title !== undefined && input.title.length > 0) {
    const backfilled = backfillFeatureSlug(projectRoot, dirName, input.title, input.now);
    if (backfilled.renamed) {
      dirName = backfilled.dirName;
      const renamedParts = parseFeatureDirName(dirName);
      if (renamedParts) {
        parts = renamedParts;
      }
    }
  }
  const record = buildPlanRecord({
    issue: parts.issue,
    title: input.title ?? parts.slug,
    slug: parts.slug,
    ulid: parts.ulid,
    summary: input.summary,
    steps: input.steps,
    modules_touched: input.modules_touched,
    decisions: input.decisions,
    risks: input.risks,
    now: input.now,
  });
  const errors = validatePlanRecord(record);
  if (errors.length > 0) {
    throw new Error(`Invalid plan.json: ${errors.join('; ')}`);
  }
  const rel = featureFilePath(dirName, 'plan');
  atomicWriteJson(join(projectRoot, rel), record);
  return { dirName, path: rel, record };
}

/** Tolerant read of a feature's `plan.json`, or null when absent/corrupt. */
export function readFeaturePlan(projectRoot: string, dirName: string): PlanRecord | null {
  return readJson<PlanRecord>(join(projectRoot, featureFilePath(dirName, 'plan')));
}

/**
 * Write the active feature's `specification.json` from an already-frozen `FeatureSpec`
 * (its `spec_hash` + freeze metadata are the script-owned proof; this only relocates it
 * into the bundle). Throws {@link NoActiveFeatureError} when no feature is active, and
 * refuses an unfrozen spec — an unfrozen spec carries no hash to attest.
 */
export function writeFeatureSpecification(
  projectRoot: string,
  sessionId: string,
  spec: FeatureSpec,
): CompiledArtifact<FeatureSpec> {
  const dirName = currentFeature(projectRoot, sessionId);
  if (!dirName) {
    throw new NoActiveFeatureError();
  }
  if (spec.frozen === null || spec.frozen === undefined) {
    throw new Error(`Refusing to persist unfrozen spec ${spec.spec_id}: freeze it first.`);
  }
  const rel = featureFilePath(dirName, 'specification');
  atomicWriteJson(join(projectRoot, rel), spec);
  return { dirName, path: rel, record: spec };
}

/** Tolerant read of a feature's `specification.json`, or null when absent/corrupt. */
export function readFeatureSpecification(projectRoot: string, dirName: string): FeatureSpec | null {
  return readJson<FeatureSpec>(join(projectRoot, featureFilePath(dirName, 'specification')));
}

/** The slots a review template exposes for the model to fill (identity comes from the dir). */
export interface ReviewRecordInput {
  summary: string;
  verdict: ReviewVerdict;
  findings?: ReviewFinding[];
  checked?: string[];
  rollback: string;
  /** Title override for the record; defaults to the feature slug when absent. */
  title?: string;
  now?: () => Date;
}

/**
 * Compile the active feature's `review.json` from a filled template (issue #402). Before
 * this, `review` owned no rigid bundle file, so its evidence was an agent-authored `.md`
 * dropped wherever the model chose — including inside the bundle dir, which is meant to
 * hold only rigid artifacts. Same contract as {@link writeFeaturePlan}: identity comes
 * from the feature dir name, the model supplies only the review body, and the record is
 * schema-validated before it is persisted. Throws {@link NoActiveFeatureError} when no
 * feature is active.
 */
export function writeFeatureReview(
  projectRoot: string,
  sessionId: string,
  input: ReviewRecordInput,
): CompiledArtifact<ReviewRecord> {
  const { dirName, parts } = activeFeatureParts(projectRoot, sessionId);
  const record = buildReviewRecord({
    issue: parts.issue,
    title: input.title ?? parts.slug,
    slug: parts.slug,
    ulid: parts.ulid,
    summary: input.summary,
    verdict: input.verdict,
    findings: input.findings,
    checked: input.checked,
    rollback: input.rollback,
    now: input.now,
  });
  const errors = validateReviewRecord(record);
  if (errors.length > 0) {
    throw new Error(`Invalid review.json: ${errors.join('; ')}`);
  }
  const rel = featureFilePath(dirName, 'review');
  atomicWriteJson(join(projectRoot, rel), record);
  return { dirName, path: rel, record };
}

/** Tolerant read of a feature's `review.json`, or null when absent/corrupt. */
export function readFeatureReview(projectRoot: string, dirName: string): ReviewRecord | null {
  return readJson<ReviewRecord>(join(projectRoot, featureFilePath(dirName, 'review')));
}
