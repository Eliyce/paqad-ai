// The first-frontend-edit reminder (issue #579, FR-15).
//
// When visual evidence is on and a change makes its first edit to a frontend file, the model is
// told once, at the edit, that it will need screenshots before review. It is model-facing only (the
// host's additionalContext on the allow path, appended to the reason on the block path), never a
// user-facing systemMessage, and it never blocks. The once-per-change marker lives under
// `.paqad/session/`, never inside the feature bundle (INV-10).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

import { visualEvidenceFlagOn } from './readiness.js';
import { frontendTriggerOrFault } from './trigger.js';

/** The reminder line (FR-15), verbatim. */
export const VISUAL_EVIDENCE_REMINDER =
  'This is a frontend change and visual evidence is on. Before review, run `paqad-ai visual-evidence run` or attach screenshots with `paqad-ai visual-evidence attach`.';

/** Where the once-per-change markers live (session scratch, never the bundle). */
export const REMINDER_MARKER_DIR = join(PATHS.AGENCY_SESSION_DIR, 'visual-evidence-reminded');

export interface VisualEvidenceReminderInput {
  projectRoot: string;
  /** The files the pending edit targets (absolute or project-relative). */
  targetPaths: readonly string[];
  /** The host session id, when known. */
  sessionId: string | null;
}

/**
 * The reminder line for this edit, or null. Returns it at most once per change: only when visual
 * evidence and coding are on, an edit target is frontend, the active bundle has no
 * visual-evidence.json yet, and this change was not reminded before. Best-effort: a marker write
 * failure yields null, so the reminder can never disturb the edit.
 */
export function visualEvidenceReminder(input: VisualEvidenceReminderInput): string | null {
  const { projectRoot } = input;
  if (!visualEvidenceFlagOn(projectRoot)) return null;
  const targets = input.targetPaths.map((target) =>
    isAbsolute(target) ? relative(projectRoot, target) : target,
  );
  if (!frontendTriggerOrFault(projectRoot, targets).triggered) return null;
  const dirName = currentFeature(projectRoot, resolveSessionId(projectRoot, input.sessionId));
  if (!dirName) return null;
  if (existsSync(join(projectRoot, featureFilePath(dirName, 'visualEvidence')))) return null;
  const marker = join(projectRoot, REMINDER_MARKER_DIR, dirName);
  try {
    mkdirSync(join(projectRoot, REMINDER_MARKER_DIR), { recursive: true });
    // `wx` creates the marker atomically and fails with EEXIST when it is already there, so the
    // once-per-change check and the write are one step, with no window between them.
    writeFileSync(marker, `${new Date().toISOString()}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch {
    // EEXIST means this change was already reminded. Any other failure means the marker could not
    // be recorded: skip the reminder rather than repeat it on every edit.
    return null;
  }
  return VISUAL_EVIDENCE_REMINDER;
}
