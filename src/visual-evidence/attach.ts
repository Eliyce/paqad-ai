import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import { readFeatureSpecification } from '@/feature-evidence/artifacts.js';
import { featureDir } from '@/feature-evidence/paths.js';

import {
  isAttachedStep,
  mergedVisualEvidenceResult,
  pad2,
  readVisualEvidenceManifest,
  slugifyCaption,
  stepDirSlug,
  uniqueSlug,
  writeVisualEvidenceManifest,
  type WriteVisualEvidenceManifestResult,
} from './manifest.js';
import { AGENT_ATTACHED_JOURNEY, type VeStep } from './types.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class VisualEvidenceAttachError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisualEvidenceAttachError';
  }
}

export interface AttachVisualEvidenceInput {
  projectRoot: string;
  dirName: string;
  files: readonly string[];
  ac?: string;
  label?: string;
  sessionId?: string | null;
  now?: () => string;
}

export interface AttachVisualEvidenceResult extends WriteVisualEvidenceManifestResult {
  acWarning?: string;
}

function checkAcceptanceCriterion(
  projectRoot: string,
  dirName: string,
  ac: string,
): string | undefined {
  const spec = readFeatureSpecification(projectRoot, dirName);
  if (!spec?.frozen) {
    return `no frozen spec in this bundle, so ${ac} was not checked against its acceptance criteria.`;
  }
  const ids = (spec.acceptance_criteria ?? []).map((criterion) => criterion.criterion_id);
  if (!ids.includes(ac)) {
    const valid = ids.length > 0 ? ids.join(', ') : 'none (the frozen spec has no criteria)';
    throw new VisualEvidenceAttachError(
      `${ac} is not an acceptance criterion of the frozen spec. Valid ids: ${valid}.`,
    );
  }
  return undefined;
}

function readPng(file: string): Buffer {
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch {
    throw new VisualEvidenceAttachError(`cannot read ${file}: the file does not exist.`);
  }
  const isPng =
    extname(file).toLowerCase() === '.png' &&
    bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
  if (!isPng) {
    throw new VisualEvidenceAttachError(
      `${file} is not a PNG image. Attach .png screenshots only.`,
    );
  }
  return bytes;
}

export function attachVisualEvidence(input: AttachVisualEvidenceInput): AttachVisualEvidenceResult {
  const { projectRoot, dirName } = input;
  const now = input.now ?? (() => new Date().toISOString());
  if (input.files.length === 0) {
    throw new VisualEvidenceAttachError('name at least one .png screenshot to attach.');
  }
  const images = input.files.map((file) => ({ file, bytes: readPng(file) }));
  const acWarning = input.ac ? checkAcceptanceCriterion(projectRoot, dirName, input.ac) : undefined;

  const existing = readVisualEvidenceManifest(projectRoot, dirName);
  const steps: VeStep[] = [...(existing?.steps ?? [])];
  const used = new Set(steps.map((step) => stepDirSlug(step.dir)));
  let index = Math.max(0, ...steps.map((step) => step.index));
  let attachedCount = steps.filter(isAttachedStep).length;
  const bundleAbs = join(projectRoot, featureDir(dirName));

  for (const { file, bytes } of images) {
    index += 1;
    attachedCount += 1;
    const caption = input.label ?? basename(file, extname(file));
    const dir = `screenshots/${pad2(index)}-${uniqueSlug(slugifyCaption(caption), used)}`;
    const dirAbs = join(bundleAbs, dir);
    mkdirSync(dirAbs, { recursive: true });
    writeFileSync(join(dirAbs, 'image.png'), bytes);
    writeFileSync(join(dirAbs, 'caption.txt'), `${caption}\n`, 'utf8');
    steps.push({
      index,
      journey_id: AGENT_ATTACHED_JOURNEY,
      journey_step: attachedCount,
      caption,
      dir,
      recorded_at: now(),
      image_sha256: createHash('sha256').update(bytes).digest('hex'),
      image_bytes: bytes.length,
      status: 'captured',
      ...(input.ac ? { ac: input.ac } : {}),
    });
  }

  const written = writeVisualEvidenceManifest(projectRoot, dirName, {
    trigger: existing?.trigger ?? { changed_files: [], matched_globs: [], packs: [] },
    plan: existing?.plan ?? [],
    steps,
    gif: existing?.gif ?? null,
    skips: existing?.skips ?? [],
    result: mergedVisualEvidenceResult(steps),
    now,
    sessionId: input.sessionId,
  });
  return acWarning ? { ...written, acWarning } : written;
}
