import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { sha256Hex } from '@/compliance/markdown.js';
import type { FeatureSpec } from '@/core/types/feature-spec.js';
import { armDecisionFromPlan } from '@/planning/decision-evidence-arm.js';
import { openVisualEvidenceReadinessPause } from '@/visual-evidence/readiness.js';

import { documentSessionId, stampFeatureDocument } from './bundle-document.js';
import { buildDocumentEnvelope, buildTextHeader, renderFrontMatter } from './envelope.js';
import { updateFeatureRecord } from './feature-record.js';
import {
  planFiles,
  planLaneResize,
  raiseLaneForAuthoring,
  raiseLaneIfGrown,
} from './lane-resize.js';
import { buildPlanRecord, buildReviewRecord } from './mint.js';
import {
  FEATURE_BUNDLE_FILES,
  featureChangeKey,
  featureDir,
  featureFilePath,
  parseFeatureDirName,
} from './paths.js';
import { backfillFeatureSlug } from './rename.js';
import {
  frameworkClaimKey,
  validateReuseSection,
  type PlanReuse,
  type ReuseProvenance,
} from './reuse.js';
import { validatePlanRecord, validateReviewRecord } from './schema.js';
import { currentFeature } from './stage-ledger.js';
import {
  FEATURE_DOC_SCHEMA_VERSION,
  SPECIFICATION_DOC_TYPE,
  SPEC_SOURCE_DOC_TYPE,
  type FeatureAuthoringLaneRaise,
  type FeatureLaneMove,
  type PlanRecord,
  type PlanRisk,
  type PlanStep,
  type ReviewFinding,
  type ReviewRecord,
  type ReviewVerdict,
} from './types.js';

export interface PlanCompileInput {
  summary: string;
  steps?: PlanStep[];
  modules_touched?: string[];
  decisions?: string[];
  risks?: PlanRisk[];
  reuse?: PlanReuse;
  title?: string;
  now?: () => Date;
}

export class ReuseDeclarationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join('\n'));
    this.name = 'ReuseDeclarationError';
    this.errors = errors;
  }
}

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

function atomicWriteText(absPath: string, text: string): void {
  mkdirSync(dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp`;
  writeFileSync(tmp, text, 'utf8');
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
  warnings?: string[];
  armedDecisions?: string[];
  readinessDecision?: string | null;
  laneResized?: FeatureLaneMove | null;
  laneRaised?: FeatureLaneMove | null;
  laneRaisedForAuthoring?: FeatureAuthoringLaneRaise | null;
}

export interface WriteFeaturePlanOptions {
  changedFiles?: readonly string[];
  gitReadable?: boolean;
}

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

export function writeFeaturePlan(
  projectRoot: string,
  sessionId: string,
  input: PlanCompileInput,
  options: WriteFeaturePlanOptions = {},
): CompiledArtifact<PlanRecord> {
  const reuseCheck = validateReuseSection({
    projectRoot,
    reuse: input.reuse,
    steps: input.steps ?? [],
  });
  if (reuseCheck.errors.length > 0) {
    throw new ReuseDeclarationError(reuseCheck.errors);
  }
  const reuse = applyComputedProvenance(input.reuse, reuseCheck.provenance);

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
    change: parts.ulid,
    session_id: sessionId,
    summary: input.summary,
    steps: input.steps,
    modules_touched: input.modules_touched,
    decisions: input.decisions,
    risks: input.risks,
    reuse,
    now: input.now,
  });
  const errors = validatePlanRecord(record);
  if (errors.length > 0) {
    throw new Error(`Invalid plan.json: ${errors.join('; ')}`);
  }
  const rel = featureFilePath(dirName, 'plan');
  atomicWriteJson(join(projectRoot, rel), record);

  updateFeatureRecord(
    projectRoot,
    dirName,
    { title: input.title ?? parts.slug, slug: parts.slug, issue: parts.issue },
    input.now,
  );

  const laneResized = planLaneResize({
    projectRoot,
    sessionId,
    dirName,
    steps: input.steps,
    changedFiles: options.changedFiles ?? [],
    changesKnown: options.changedFiles !== undefined && options.gitReadable !== false,
    now: input.now,
  });
  const laneRaisedForAuthoring = raiseLaneForAuthoring({
    projectRoot,
    dirName,
    plannedFiles: planFiles(input.steps),
    changedFiles: options.changedFiles ?? [],
    now: input.now,
  });
  const laneRaised = laneResized
    ? null
    : raiseLaneIfGrown({
        projectRoot,
        dirName,
        plannedFiles: planFiles(input.steps),
        changedFiles: options.changedFiles ?? [],
        now: input.now,
      });

  const armed = armDecisionFromPlan({
    projectRoot,
    changeKey: dirName,
    sessionId,
    constructs: (input.reuse?.new_constructs ?? []).map((construct) => ({
      name: construct.name,
      justification: construct.justification,
    })),
  });

  const readinessDecision = openVisualEvidenceReadinessPause({
    projectRoot,
    dirName,
    files: [
      ...new Set([
        ...(input.steps ?? []).flatMap((step) => step.files ?? []),
        ...(options.changedFiles ?? []),
      ]),
    ],
  });

  return {
    dirName,
    path: rel,
    record,
    warnings: [...reuseCheck.warnings, ...armed.warnings],
    armedDecisions: armed.minted,
    readinessDecision,
    laneResized,
    laneRaised,
    laneRaisedForAuthoring,
  };
}

function applyComputedProvenance(
  reuse: PlanReuse | undefined,
  computed: Record<string, ReuseProvenance>,
): PlanReuse | undefined {
  if (reuse === undefined || Object.keys(computed).length === 0) {
    return reuse;
  }
  return {
    ...reuse,
    reusing: (reuse.reusing ?? []).map((claim) => {
      if (claim.package === undefined) {
        return claim;
      }
      const verdict = computed[frameworkClaimKey(claim.package, claim.symbol)];
      return verdict === undefined ? claim : { ...claim, provenance: verdict };
    }),
  };
}

export function readFeaturePlan(projectRoot: string, dirName: string): PlanRecord | null {
  return readJson<PlanRecord>(join(projectRoot, featureFilePath(dirName, 'plan')));
}

export function writeFeatureSpecification(
  projectRoot: string,
  sessionId: string,
  spec: FeatureSpec,
  markdown: string,
): CompiledArtifact<FeatureSpec> {
  const dirName = currentFeature(projectRoot, sessionId);
  if (!dirName) {
    throw new NoActiveFeatureError();
  }
  if (spec.frozen === null || spec.frozen === undefined) {
    throw new Error(`Refusing to persist unfrozen spec ${spec.spec_id}: freeze it first.`);
  }
  if (sha256Hex(markdown) !== spec.spec_hash) {
    throw new Error(
      `Refusing to persist spec ${spec.spec_id}: the source does not hash to its spec_hash.`,
    );
  }
  const sessionForDocs = documentSessionId(projectRoot, dirName, sessionId);
  const header = buildTextHeader({
    docType: SPEC_SOURCE_DOC_TYPE,
    change: featureChangeKey(dirName),
    sessionId: sessionForDocs,
    schemaVersion: FEATURE_DOC_SCHEMA_VERSION,
    body: markdown,
  });
  atomicWriteText(
    join(projectRoot, featureFilePath(dirName, 'specMd')),
    renderFrontMatter(header, markdown),
  );
  const body: Record<string, unknown> = { ...spec, spec_file: FEATURE_BUNDLE_FILES.specMd };
  delete body.schema_version;
  const record = stampFeatureDocument({
    projectRoot,
    dirName,
    docType: SPECIFICATION_DOC_TYPE,
    schemaVersion: FEATURE_DOC_SCHEMA_VERSION,
    sessionId: sessionForDocs,
    body,
  }) as unknown as FeatureSpec;
  const rel = featureFilePath(dirName, 'specification');
  atomicWriteJson(join(projectRoot, rel), record);
  updateFeatureRecord(projectRoot, dirName, { spec_id: spec.spec_id });
  return { dirName, path: rel, record };
}

export function readFeatureSpecification(projectRoot: string, dirName: string): FeatureSpec | null {
  return readJson<FeatureSpec>(join(projectRoot, featureFilePath(dirName, 'specification')));
}

export interface ReviewRecordInput {
  summary: string;
  verdict: ReviewVerdict;
  findings?: ReviewFinding[];
  checked?: string[];
  rollback: string;
  title?: string;
  now?: () => Date;
}

export function writeFeatureReview(
  projectRoot: string,
  sessionId: string,
  input: ReviewRecordInput,
): CompiledArtifact<ReviewRecord> {
  const { dirName, parts } = activeFeatureParts(projectRoot, sessionId);
  const record = buildReviewRecord({
    change: parts.ulid,
    session_id: sessionId,
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

export function readFeatureReview(projectRoot: string, dirName: string): ReviewRecord | null {
  return readJson<ReviewRecord>(join(projectRoot, featureFilePath(dirName, 'review')));
}

export const SKILL_RECORD_DOC_TYPE = 'paqad.skill-record';
export const SKILL_RECORD_SCHEMA_VERSION = 1;
export const SKILL_RECORD_WRITER = 'paqad-ai skill release';

export interface SkillRecordOverride {
  gate: string;
  reason: string;
  by: string;
  at: string;
}

export interface SkillRecordBody {
  skill: string;
  status: 'passed' | 'overridden';
  version: string;
  released_path: string;
  folder_hash: string;
  evidence_path: string;
  overrides: SkillRecordOverride[];
  labels: string[];
}

export function skillRecordFilename(name: string): string {
  return `skill-${name}.json`;
}

export function skillRecordPath(dirName: string, name: string): string {
  return join(featureDir(dirName), skillRecordFilename(name));
}

export function readSkillRecord(
  projectRoot: string,
  dirName: string,
  name: string,
): (SkillRecordBody & { change?: string }) | null {
  return readJson<SkillRecordBody & { change?: string }>(
    join(projectRoot, skillRecordPath(dirName, name)),
  );
}

function sameSkillRecord(existing: SkillRecordBody | null, body: SkillRecordBody): boolean {
  if (existing === null) return false;
  return (
    JSON.stringify({ ...body }) ===
    JSON.stringify({
      skill: existing.skill,
      status: existing.status,
      version: existing.version,
      released_path: existing.released_path,
      folder_hash: existing.folder_hash,
      evidence_path: existing.evidence_path,
      overrides: existing.overrides,
      labels: existing.labels,
    })
  );
}

export function writeSkillRecord(
  projectRoot: string,
  sessionId: string,
  body: SkillRecordBody,
  now?: () => Date,
): { dirName: string; path: string; written: boolean } {
  const { dirName, parts } = activeFeatureParts(projectRoot, sessionId);
  const rel = skillRecordPath(dirName, body.skill);
  if (sameSkillRecord(readSkillRecord(projectRoot, dirName, body.skill), body)) {
    return { dirName, path: rel, written: false };
  }
  const record = buildDocumentEnvelope({
    docType: SKILL_RECORD_DOC_TYPE,
    change: parts.ulid,
    sessionId,
    schemaVersion: SKILL_RECORD_SCHEMA_VERSION,
    now,
    body: { ...body },
  });
  atomicWriteJson(join(projectRoot, rel), record);
  return { dirName, path: rel, written: true };
}
