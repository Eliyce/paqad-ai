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
    const group = byTarget.get(key)!;
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
    });
  }

  return {
    findings,
    conflicts,
    ...(voiceWarnings.length > 0 ? { voice_warnings: [...voiceWarnings] } : {}),
  };
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}
