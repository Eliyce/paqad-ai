// `paqad-ai visual-evidence attach` (issue #579, FR-11).
//
// Lets the agent (or developer) add its own screenshots to the active feature bundle when a
// scripted capture cannot run here: no documented flow, no capture script, no browser. Each PNG is
// copied into `screenshots/NN-<slug>/image.png` with a `caption.txt`, hashed, and recorded in
// `visual-evidence.json` as an `agent-attached` step, so the gate verifies it like any capture and
// the report never presents it as a scripted one. Everything is validated before anything is
// written, so a refused attach leaves the bundle untouched.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import { featureDir } from '@/feature-evidence/paths.js';

import {
  isAttachedStep,
  pad2,
  readVisualEvidenceManifest,
  slugifyCaption,
  stepDirSlug,
  uniqueSlug,
  writeVisualEvidenceManifest,
  type WriteVisualEvidenceManifestResult,
} from './manifest.js';
import { AGENT_ATTACHED_JOURNEY, type VeStep } from './types.js';

/** The 8-byte signature every PNG file starts with. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A refused attach: one plain line saying why. Nothing was written. */
export class VisualEvidenceAttachError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisualEvidenceAttachError';
  }
}

export interface AttachVisualEvidenceInput {
  projectRoot: string;
  dirName: string;
  /** PNG paths to attach, in order (absolute, or relative to the process cwd). */
  files: readonly string[];
  /** The acceptance criterion these screenshots prove (e.g. `AC-3`). */
  ac?: string;
  /** Caption for the screenshots; defaults to each file's base name. */
  label?: string;
  now?: () => string;
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

/**
 * Attach PNG screenshots to the bundle's visual evidence. Merges into an existing manifest (its
 * scripted steps, plan and skips are kept) or writes a new one. Throws
 * {@link VisualEvidenceAttachError} before writing anything when a file is missing or not a PNG.
 */
export function attachVisualEvidence(
  input: AttachVisualEvidenceInput,
): WriteVisualEvidenceManifestResult {
  const { projectRoot, dirName } = input;
  const now = input.now ?? (() => new Date().toISOString());
  if (input.files.length === 0) {
    throw new VisualEvidenceAttachError('name at least one .png screenshot to attach.');
  }
  // Validate every file first, so a bad one leaves nothing half-written.
  const images = input.files.map((file) => ({ file, bytes: readPng(file) }));

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
      captured_at: now(),
      image_sha256: createHash('sha256').update(bytes).digest('hex'),
      image_bytes: bytes.length,
      status: 'captured',
      ...(input.ac ? { ac: input.ac } : {}),
    });
  }

  return writeVisualEvidenceManifest(projectRoot, dirName, {
    trigger: existing?.trigger ?? { changed_files: [], matched_globs: [], packs: [] },
    plan: existing?.plan ?? [],
    steps,
    gif: existing?.gif ?? null,
    skips: existing?.skips ?? [],
    // A partial scripted run stays partial (its failed step is still a real gap).
    result: existing?.result === 'partial' ? 'partial' : 'captured',
    now,
  });
}
