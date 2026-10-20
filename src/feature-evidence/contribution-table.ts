import type { AcceptedFinding } from '@/core/types/feature-spec.js';
import type { AgentRole } from '@/core/types/agent.js';

const ROLE_ACRONYMS: Record<string, string> = { qa: 'QA', ux: 'UX', ui: 'UI', db: 'DB' };

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

export interface ContributionTraceEntry {
  id: string;
  source: string;
}

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

function describeOtherSource(entry: ContributionTraceEntry): string {
  if (entry.source.startsWith('D-')) return `${entry.id}: from your answer (${entry.source}).`;
  return `${entry.id}: from the request.`;
}
