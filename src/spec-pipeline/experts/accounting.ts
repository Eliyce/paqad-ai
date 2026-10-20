import type { AgentRole } from '@/core/types/agent.js';

import type { ExpertAccounting, ExpertNeed, ExpertNote, ExpertRunAccounting } from './types.js';

export interface BuildAccountingInput {
  needs: readonly ExpertNeed[];
  notes: readonly ExpertNote[];
  tokens: Partial<Record<AgentRole, number>>;
  tracedFindingIds: ReadonlySet<string>;
  warnings?: readonly string[];
}

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
