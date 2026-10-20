import { cpSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { stampFeatureDocument } from '@/feature-evidence/bundle-document.js';
import { featureDir, featureFilePath } from '@/feature-evidence/paths.js';
import { validateVisualEvidenceRecord } from '@/feature-evidence/schema.js';

import {
  AGENT_ATTACHED_JOURNEY,
  VISUAL_EVIDENCE_DOC_TYPE,
  VISUAL_EVIDENCE_SCHEMA_VERSION,
  type VeResult,
  type VeSkip,
  type VeSource,
  type VeStep,
  type VeTrigger,
  type VisualEvidenceManifest,
} from './types.js';

export function slugifyCaption(caption: string): string {
  const slug = caption
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'step';
}

export function pad2(n: number): string {
  return String(Math.min(n, 99)).padStart(2, '0');
}

export function uniqueSlug(slug: string, used: Set<string>): string {
  if (!used.has(slug)) {
    used.add(slug);
    return slug;
  }
  let n = 2;
  while (used.has(`${slug}-${n}`)) n += 1;
  const out = `${slug}-${n}`;
  used.add(out);
  return out;
}

export function stepDirSlug(dir: string): string {
  return basename(dir).replace(/^\d+-/, '');
}

export interface WriteVisualEvidenceManifestInput {
  trigger: VeTrigger;
  plan: VisualEvidenceManifest['plan'];
  steps: VeStep[];
  gif: VisualEvidenceManifest['gif'];
  skips: VeSkip[];
  result: VeResult;
  now: () => string;
  sessionId?: string | null;
}

export interface WriteVisualEvidenceManifestResult {
  wrote: boolean;
  manifest: VisualEvidenceManifest | null;
  result: VeResult;
  skips: VeSkip[];
}

export function isAttachedStep(step: VeStep): boolean {
  return step.journey_id === AGENT_ATTACHED_JOURNEY;
}

function manifestSource(steps: readonly VeStep[]): VeSource | undefined {
  if (!steps.some(isAttachedStep)) return undefined;
  return steps.some((step) => !isAttachedStep(step)) ? 'mixed' : 'agent-attached';
}

export function writeVisualEvidenceManifest(
  projectRoot: string,
  dirName: string,
  input: WriteVisualEvidenceManifestInput,
): WriteVisualEvidenceManifestResult {
  const source = manifestSource(input.steps);
  const recordedAt = input.now();
  const manifest = stampFeatureDocument({
    projectRoot,
    dirName,
    docType: VISUAL_EVIDENCE_DOC_TYPE,
    schemaVersion: VISUAL_EVIDENCE_SCHEMA_VERSION,
    sessionId: input.sessionId,
    now: () => new Date(recordedAt),
    body: {
      trigger: input.trigger,
      plan: input.plan,
      steps: input.steps,
      gif: input.gif,
      skips: input.skips,
      result: input.result,
      ...(source ? { source } : {}),
    },
  }) as VisualEvidenceManifest;

  const errors = validateVisualEvidenceRecord(manifest);
  if (errors.length > 0) {
    throw new Error(
      `internal: visual-evidence manifest failed its own schema: ${errors.join('; ')}`,
    );
  }

  const target = join(projectRoot, featureFilePath(dirName, 'visualEvidence'));
  mkdirSync(join(projectRoot, featureDir(dirName)), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  renameSync(tmp, target);

  return { wrote: true, manifest, result: input.result, skips: input.skips };
}

function normalizeStep(step: VeStep & { captured_at?: string }): VeStep {
  if (step.recorded_at !== undefined || step.captured_at === undefined) return step;
  const { captured_at: recordedAt, ...rest } = step;
  return { ...rest, recorded_at: recordedAt };
}

export function readVisualEvidenceManifest(
  projectRoot: string,
  dirName: string,
): VisualEvidenceManifest | null {
  try {
    const raw = readFileSync(join(projectRoot, featureFilePath(dirName, 'visualEvidence')), 'utf8');
    const manifest = JSON.parse(raw) as VisualEvidenceManifest;
    return Array.isArray(manifest.steps)
      ? { ...manifest, steps: manifest.steps.map(normalizeStep) }
      : manifest;
  } catch {
    return null;
  }
}

export function readAttachedSteps(projectRoot: string, dirName: string): VeStep[] {
  return (readVisualEvidenceManifest(projectRoot, dirName)?.steps ?? []).filter(isAttachedStep);
}

export function mergedVisualEvidenceResult(steps: readonly VeStep[]): VeResult {
  if (steps.some((step) => step.status === 'failed')) return 'partial';
  return steps.some((step) => step.status === 'captured') ? 'captured' : 'skipped';
}

export function mergeAttachedSteps(
  attached: readonly VeStep[],
  input: WriteVisualEvidenceManifestInput,
): WriteVisualEvidenceManifestInput {
  if (attached.length === 0) return input;
  const steps = [...attached, ...input.steps];
  return { ...input, steps, result: mergedVisualEvidenceResult(steps) };
}

export function copyAttachedStepDirs(
  projectRoot: string,
  dirName: string,
  attached: readonly VeStep[],
  tmpAbs: string,
): void {
  const bundleAbs = join(projectRoot, featureDir(dirName));
  for (const step of attached) {
    cpSync(join(bundleAbs, step.dir), join(tmpAbs, basename(step.dir)), { recursive: true });
  }
}
