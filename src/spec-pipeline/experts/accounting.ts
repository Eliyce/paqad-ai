// Per-expert accounting (issue #521, FR-7 / AC-5 / AC-7; changed_spec is trace-based in #547).
//
// Every expert call is self-auditing: which expert ran, WHY it fired (from the need artifact),
// the tokens it spent, and the important field: whether its notes actually reached the crafted
// spec. An expert that fires often and changes nothing shows up here as pure cost and can be
// retired on evidence, which feeds straight back into the FR-9 gate. Deterministic; the caller
// supplies the token actuals (paqad measures no tokens from Node, they ride in from the run).
//
// Issue #547 (FR-11.2): `changed_spec` is now TRACE-based, not a merge-survival proxy. An expert
// changed the spec only when one of its finding ids appears as a `source` in the run's trace.json,
// so an accepted finding that never reached a spec line is visible as pure cost.

import type { AgentRole } from '@/core/types/agent.js';

import type { ExpertAccounting, ExpertNeed, ExpertNote, ExpertRunAccounting } from './types.js';

export interface BuildAccountingInput {
  /** The validated experts that ran, with their reasons. */
  needs: readonly ExpertNeed[];
  /** The notes each expert produced. */
  notes: readonly ExpertNote[];
  /** Actual tokens spent per role (missing counts as 0). */
  tokens: Partial<Record<AgentRole, number>>;
  /** Finding ids that appear as a `source` in the run's trace.json (issue #547, FR-11.2). */
  tracedFindingIds: ReadonlySet<string>;
  /** Warnings accumulated upstream (e.g. slice ceiling breach), carried through, not dropped. */
  warnings?: readonly string[];
}

/**
 * Build the run's expert accounting. `changed_spec` is trace-based (issue #547, FR-11.2): true when
 * at least one of the expert's finding ids appears as a source in the run's trace.json, the signal
 * that its notes reached the crafted spec. An expert with no notes, or whose findings never trace
 * to a spec line, records `changed_spec: false` and stands out as pure cost (AC-7).
 */
export function buildExpertAccounting(input: BuildAccountingInput): ExpertRunAccounting {
  const notesByRole = new Map<AgentRole, ExpertNote>();
  for (const note of input.notes) {
    notesByRole.set(note.role, note);
  }

  const experts: ExpertAccounting[] = input.needs.map((need) => {
    const note = notesByRole.get(need.role);
    const findings = note?.findings ?? [];
    const changed = findings.some(
      (finding) => finding.id !== undefined && input.tracedFindingIds.has(finding.id),
    );
    // "Nothing to add" (issue #558, FR-2.1): no finding, or the single non-goal exit line.
    const empty =
      findings.length === 0 || (findings.length === 1 && findings[0]!.kind === 'non-goal');
    return {
      role: need.role,
      reason: need.reason,
      tokens: input.tokens[need.role] ?? 0,
      changed_spec: changed,
      ...(need.origin === undefined ? {} : { origin: need.origin }),
      empty,
    };
  });

  return {
    experts,
    total_tokens: experts.reduce((total, entry) => total + entry.tokens, 0),
    warnings: [...(input.warnings ?? [])],
  };
}
