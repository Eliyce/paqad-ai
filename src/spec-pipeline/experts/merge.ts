import type { AgentRole } from '@/core/types/agent.js';

import type {
  ExpertConflict,
  ExpertFinding,
  ExpertNote,
  MergedExpertNotes,
  VoiceWarning,
} from './types.js';

interface AttributedFinding {
  role: AgentRole;
  finding: ExpertFinding;
}

export function mergeExpertNotes(
  notes: readonly ExpertNote[],
  voiceWarnings: readonly VoiceWarning[] = [],
): MergedExpertNotes {
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
    const group = collapseSameRole(byTarget.get(key)!);
    const distinctClaims = [...new Set(group.map((entry) => normalize(entry.finding.claim)))];
    if (distinctClaims.length <= 1) {
      findings.push(group[0]!.finding);
      continue;
    }
    conflicts.push({
      target: group[0]!.finding.target,
      roles: group.map((entry) => entry.role),
      claims: group.map((entry) => entry.finding.claim),
      finding_ids: group.map((entry) => entry.finding.id ?? ''),
      ...(group.some((entry) => entry.finding.severity !== undefined)
        ? { severities: group.map((entry) => entry.finding.severity ?? null) }
        : {}),
    });
  }

  return {
    findings,
    conflicts,
    ...(voiceWarnings.length > 0 ? { voice_warnings: [...voiceWarnings] } : {}),
  };
}

function collapseSameRole(group: readonly AttributedFinding[]): AttributedFinding[] {
  const byRole = new Map<AgentRole, AttributedFinding[]>();
  for (const entry of group) {
    const list = byRole.get(entry.role);
    if (list) list.push(entry);
    else byRole.set(entry.role, [entry]);
  }
  return [...byRole.values()].map((entries) => {
    if (entries.length === 1) return entries[0]!;
    let kept = entries[0]!;
    for (const entry of entries.slice(1)) {
      if (entry.finding.claim.trim().length > kept.finding.claim.trim().length) kept = entry;
    }
    const mergedFrom = entries
      .flatMap((entry) => [entry.finding.id, ...(entry.finding.merged_from ?? [])])
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    return {
      role: kept.role,
      finding: { ...kept.finding, merged_from: [...new Set(mergedFrom)] },
    };
  });
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}
