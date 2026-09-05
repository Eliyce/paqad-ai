// Merge expert notes into the craft input, surfacing conflicts (issue #521, FR-6 / AC-9 / P2-T7).
//
// Experts run independently, so two of them can make contradictory claims about the SAME target
// (the db-expert says "denormalise orders", the data-modeler says "keep orders normalised"). The
// merge must never silently pick one: a contradiction is surfaced as a detected conflict carrying
// every competing claim, so the craft step (and the human) see the disagreement rather than a
// quietly-chosen winner. Findings that agree, or that concern different targets, flow through as
// the merged set. Deterministic; zero model tokens.

import type { AgentRole } from '@/core/types/agent.js';

import type { ExpertConflict, ExpertFinding, ExpertNote, MergedExpertNotes } from './types.js';

/** One claim about a target, tagged with the expert that made it. */
interface AttributedFinding {
  role: AgentRole;
  finding: ExpertFinding;
}

/**
 * Merge the notes. Findings are grouped by their `target`. A target on which every claim is
 * identical contributes that one finding to the merged set. A target carrying two OR MORE
 * DISTINCT claims is a conflict: none of its findings enter the merged set, and one
 * {@link ExpertConflict} records the disagreeing roles and their claims (AC-9). Target grouping
 * and claim comparison are case- and whitespace-insensitive so trivial phrasing differences do
 * not read as either a duplicate or a conflict.
 */
export function mergeExpertNotes(notes: readonly ExpertNote[]): MergedExpertNotes {
  const byTarget = new Map<string, AttributedFinding[]>();
  const order: string[] = [];
  for (const note of notes) {
    for (const finding of note.findings) {
      const key = normalize(finding.target);
      if (!byTarget.has(key)) {
        byTarget.set(key, []);
        order.push(key);
      }
      byTarget.get(key)!.push({ role: note.role, finding });
    }
  }

  const findings: ExpertFinding[] = [];
  const conflicts: ExpertConflict[] = [];
  for (const key of order) {
    const group = byTarget.get(key)!;
    const distinctClaims = [...new Set(group.map((entry) => normalize(entry.finding.claim)))];
    if (distinctClaims.length <= 1) {
      // Agreement (or a lone claim): the first finding represents the group.
      findings.push(group[0]!.finding);
      continue;
    }
    // Disagreement: surface it, choose nothing (AC-9). One entry per (role, claim) pair, in the
    // order the notes were given, so the record is stable and every side is shown.
    conflicts.push({
      target: group[0]!.finding.target,
      roles: group.map((entry) => entry.role),
      claims: group.map((entry) => entry.finding.claim),
    });
  }

  return { findings, conflicts };
}

/** Case- and whitespace-insensitive normalization for target/claim comparison. */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}
