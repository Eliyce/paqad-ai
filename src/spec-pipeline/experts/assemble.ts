// Assemble the expert run accounting from the recorded run (issue #521, FR-7 / FR-8).
//
// Ties the stored need + notes artifacts to the pure functions: validate them against the roster,
// size the slices (for the ceiling warning), merge the notes (surfacing conflicts), and build the
// per-expert accounting. Returns null when the experts step never ran — the finish provenance
// then carries NO experts block, so a flag-off run stays byte-identical to v1 (INV-1 / AC-7).

import { readExpertNeed, readExpertNotes } from '../run-store.js';
import { readTrace } from '../trace.js';
import { buildExpertAccounting } from './accounting.js';
import { mergeExpertNotes } from './merge.js';
import { validateExpertNeed } from './need.js';
import { validateExpertNotes } from './notes.js';
import { planExpertSlices } from './slice.js';
import type { ExpertConflict, ExpertRunAccounting } from './types.js';

/** The accounting plus any conflicts detected while merging (both fold into provenance). */
export interface AssembledExpertRun {
  accounting: ExpertRunAccounting;
  conflicts: ExpertConflict[];
}

/**
 * Assemble the run's expert accounting from the run store. `ceiling` is the run token ceiling (used
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
  // changed_spec is trace-based (issue #547, FR-11.2): an expert changed the spec only when one of
  // its finding ids appears as a source in the run's trace. No trace yet (craft not run) means
  // no expert has changed the spec, which is the honest state before the craft step.
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
