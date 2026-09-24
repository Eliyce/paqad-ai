// The visual-evidence manifest writer and naming helpers (issue #551, shared since issue #579).
//
// Two verbs write `visual-evidence.json` into a feature bundle: `visual-evidence run` (scripted
// captures) and `visual-evidence attach` (agent-attached screenshots). Both go through the one
// writer here, which validates the record, stamps its content hash and its `source`, and writes it
// atomically. A later scripted run keeps every agent-attached step (INV-8) through
// `mergeAttachedSteps` + `copyAttachedStepDirs`.

import { cpSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { computeContentHash } from '@/feature-evidence/mint.js';
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

/** Windows-safe kebab slug of a caption: [a-z0-9-] only, max 40, non-empty fallback. */
export function slugifyCaption(caption: string): string {
  const slug = caption
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'step';
}

/** Zero-padded 2-digit position (01..99, clamped at 99 for the dir name). */
export function pad2(n: number): string {
  return String(Math.min(n, 99)).padStart(2, '0');
}

/** A slug not yet in `used` (`slug`, then `slug-2`, `slug-3`, ...), recorded as used. */
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

/** The slug part of a step dir (`screenshots/03-open-cart` -> `open-cart`). */
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
}

export interface WriteVisualEvidenceManifestResult {
  wrote: boolean;
  manifest: VisualEvidenceManifest | null;
  result: VeResult;
  skips: VeSkip[];
}

/** True for a step the agent attached (never a scripted capture). */
export function isAttachedStep(step: VeStep): boolean {
  return step.journey_id === AGENT_ATTACHED_JOURNEY;
}

/** `agent-attached` / `mixed` when attached steps are present, else undefined (scripted only). */
function manifestSource(steps: readonly VeStep[]): VeSource | undefined {
  if (!steps.some(isAttachedStep)) return undefined;
  return steps.some((step) => !isAttachedStep(step)) ? 'mixed' : 'agent-attached';
}

/** Build, validate, and atomically write the manifest. */
export function writeVisualEvidenceManifest(
  projectRoot: string,
  dirName: string,
  input: WriteVisualEvidenceManifestInput,
): WriteVisualEvidenceManifestResult {
  const source = manifestSource(input.steps);
  const base: Omit<VisualEvidenceManifest, 'content_hash'> = {
    schema_version: VISUAL_EVIDENCE_SCHEMA_VERSION,
    doc_type: VISUAL_EVIDENCE_DOC_TYPE,
    generated_at: input.now(),
    trigger: input.trigger,
    plan: input.plan,
    steps: input.steps,
    gif: input.gif,
    skips: input.skips,
    result: input.result,
    ...(source ? { source } : {}),
  };
  const manifest: VisualEvidenceManifest = {
    ...base,
    content_hash: computeContentHash(base as unknown as Record<string, unknown>),
  };

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

/** The bundle's current manifest, or null when absent or unreadable. */
export function readVisualEvidenceManifest(
  projectRoot: string,
  dirName: string,
): VisualEvidenceManifest | null {
  try {
    const raw = readFileSync(join(projectRoot, featureFilePath(dirName, 'visualEvidence')), 'utf8');
    return JSON.parse(raw) as VisualEvidenceManifest;
  } catch {
    return null;
  }
}

/** The agent-attached steps of the bundle's current manifest (empty when none). */
export function readAttachedSteps(projectRoot: string, dirName: string): VeStep[] {
  return (readVisualEvidenceManifest(projectRoot, dirName)?.steps ?? []).filter(isAttachedStep);
}

/**
 * Carry already-attached steps into a scripted run's manifest (issue #579, FR-13): they go first,
 * keep their dirs and hashes, and a run that captured nothing new still reads `captured`. A run
 * with any failed scripted step reads `partial` instead: the failed step is still a real gap, so
 * attached screenshots never lift an all-failed run above a partly successful one.
 */
export function mergeAttachedSteps(
  attached: readonly VeStep[],
  input: WriteVisualEvidenceManifestInput,
): WriteVisualEvidenceManifestInput {
  if (attached.length === 0) return input;
  const anyFailed = input.steps.some((step) => step.status === 'failed');
  let result = input.result;
  if (anyFailed) result = 'partial';
  else if (result === 'skipped') result = 'captured';
  return { ...input, steps: [...attached, ...input.steps], result };
}

/**
 * Copy each attached step folder from the live `screenshots/` into a scripted run's temp build,
 * so the atomic swap that replaces `screenshots/` keeps the attached image files.
 */
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
