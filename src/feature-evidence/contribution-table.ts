// The "Who contributed what" attribution table (issue #558, FR-13.2 / FR-13.3).
//
// #547 traces every spec line to a source id, and #558 keeps a durable snapshot of every accepted
// finding (with the chief's renames applied). Joining the two, by finding id, answers "who added
// FR-2 and what did they say" on the face of the spec. Pure and deterministic: the same trace and
// findings always render the same table (FR-13.3), zero model tokens.

import type { AcceptedFinding } from '@/core/types/feature-spec.js';
import type { AgentRole } from '@/core/types/agent.js';

/** Acronyms that keep their casing when a role id is shown in plain words. */
const ROLE_ACRONYMS: Record<string, string> = { qa: 'QA', ux: 'UX', ui: 'UI', db: 'DB' };

/** A role id in plain words: `application-architect` → `Application architect`, `qa-engineer` → `QA engineer`. */
export function roleInPlainWords(role: AgentRole): string {
  const words = role.split('-');
  return words
    .map((word, index) => {
      const acronym = ROLE_ACRONYMS[word];
      if (acronym) return acronym;
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1);
      return word;
    })
    .join(' ');
}

/** A trace entry: a spec line id and the source it derives from. */
export interface ContributionTraceEntry {
  id: string;
  source: string;
}

/**
 * Render the `## Who contributed what` section (FR-13.2), or `''` when no spec line traces to an
 * expert finding. One row per spec line whose trace source is an `EX-…` finding id, joined to the
 * snapshot by id; lines sourced from the request or a ledgered answer are listed in one line below.
 * Pure and deterministic (FR-13.3).
 */
export function renderContributionTable(
  trace: ContributionTraceEntry[],
  findings: AcceptedFinding[],
): string {
  const findingById = new Map(findings.map((finding) => [finding.id, finding]));
  const rows: string[] = [];
  const otherLines: string[] = [];
  for (const entry of trace) {
    const finding = findingById.get(entry.source);
    if (finding) {
      rows.push(`| ${entry.id} | ${roleInPlainWords(finding.role)} | ${finding.claim} |`);
    } else {
      otherLines.push(describeOtherSource(entry));
    }
  }
  if (rows.length === 0) return '';
  const lines: string[] = [
    '## Who contributed what',
    '',
    '| Line | From | What the expert said |',
    '| --- | --- | --- |',
    ...rows,
  ];
  if (otherLines.length > 0) {
    lines.push('', otherLines.join(' '));
  }
  return lines.join('\n');
}

/** How a non-expert-sourced line reads below the table (from the request, or a ledgered answer). */
function describeOtherSource(entry: ContributionTraceEntry): string {
  if (entry.source.startsWith('D-')) return `${entry.id}: from your answer (${entry.source}).`;
  return `${entry.id}: from the request.`;
}
