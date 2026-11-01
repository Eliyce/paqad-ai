import { readExpertNeed, readExpertNotes } from '../run-store.js';
import { readTrace } from '../trace.js';
import { buildExpertAccounting } from './accounting.js';
import { mergeExpertNotes } from './merge.js';
import { validateExpertNeed } from './need.js';
import { validateExpertNotes } from './notes.js';
import { planExpertSlices } from './slice.js';
import type { ExpertConflict, ExpertRunAccounting } from './types.js';

export interface AssembledExpertRun {
  accounting: ExpertRunAccounting;
  conflicts: ExpertConflict[];
}

export function assembleExpertRun(
  projectRoot: string,
  dirName: string,
  ceiling: number,
): AssembledExpertRun | null {
  const rawNeed = readExpertNeed(projectRoot, dirName);
  if (rawNeed === null) return null;
  const need = validateExpertNeed(rawNeed);
  if (!need.ok || !need.artifact) return null;

  const roles = need.artifact.experts.map((expert) => expert.role);
  const slicePlan = planExpertSlices(roles, ceiling);

  const rawNotes = readExpertNotes(projectRoot, dirName);
  const notes =
    rawNotes === null
      ? { ok: true as const, artifact: { notes: [], tokens: {} } }
      : validateExpertNotes(rawNotes, undefined, undefined, { requireQaVerdicts: false });
  const notesArtifact = notes.ok && notes.artifact ? notes.artifact : { notes: [], tokens: {} };

  const merged = mergeExpertNotes(notesArtifact.notes);
  const trace = readTrace(projectRoot, dirName);
  const tracedFindingIds = new Set((trace?.entries ?? []).map((entry) => entry.source));
  const accounting = buildExpertAccounting({
    needs: need.artifact.experts,
    notes: notesArtifact.notes,
    tokens: notesArtifact.tokens,
    tracedFindingIds,
    warnings: slicePlan.warnings,
  });

  return { accounting, conflicts: merged.conflicts };
}
