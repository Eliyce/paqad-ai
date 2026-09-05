// Assemble the expert run accounting from the scratch artifacts (issue #521, FR-7 / FR-8).
//
// Ties the stored need + notes artifacts to the pure functions: validate them against the roster,
// size the slices (for the ceiling warning), merge the notes (surfacing conflicts), and build the
// per-expert accounting. Returns null when the experts step never ran — the finish provenance
// then carries NO experts block, so a flag-off run stays byte-identical to v1 (INV-1 / AC-7).

import { buildExpertAccounting } from './accounting.js';
import { mergeExpertNotes } from './merge.js';
import { validateExpertNeed } from './need.js';
import { readExpertNeed, readExpertNotes, validateExpertNotes } from './notes.js';
import { planExpertSlices } from './slice.js';
import type { ExpertConflict, ExpertRunAccounting } from './types.js';

/** The accounting plus any conflicts detected while merging (both fold into provenance). */
export interface AssembledExpertRun {
  accounting: ExpertRunAccounting;
  conflicts: ExpertConflict[];
}

/**
 * Assemble the run's expert accounting from scratch. `ceiling` is the run token ceiling (used
 * only to compute the slice warning). Returns null when no need artifact was recorded, or when
 * the recorded need artifact is invalid — in both cases the run has no honest expert accounting
 * to report, and finish records none.
 */
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
      : validateExpertNotes(rawNotes);
  const notesArtifact = notes.ok && notes.artifact ? notes.artifact : { notes: [], tokens: {} };

  const merged = mergeExpertNotes(notesArtifact.notes);
  const accounting = buildExpertAccounting({
    needs: need.artifact.experts,
    notes: notesArtifact.notes,
    tokens: notesArtifact.tokens,
    merged,
    warnings: slicePlan.warnings,
  });

  return { accounting, conflicts: merged.conflicts };
}
