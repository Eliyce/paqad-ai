import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

import { visualEvidenceFlagOn } from './readiness.js';
import { frontendTriggerOrFault } from './trigger.js';

export const VISUAL_EVIDENCE_REMINDER =
  'This is a frontend change and visual evidence is on. Before review, run `paqad-ai visual-evidence run` or attach screenshots with `paqad-ai visual-evidence attach`.';

export const REMINDER_MARKER_DIR = join(PATHS.AGENCY_SESSION_DIR, 'visual-evidence-reminded');

export interface VisualEvidenceReminderInput {
  projectRoot: string;
  targetPaths: readonly string[];
  sessionId: string | null;
}

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
    writeFileSync(marker, `${new Date().toISOString()}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch {
    return null;
  }
  return VISUAL_EVIDENCE_REMINDER;
}
