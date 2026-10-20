import type { TicketProviderKind } from '@/core/types/project-profile.js';

const JIRA_REF = /\b[A-Z][A-Z0-9]+-\d+\b/g;
const GITHUB_REF = /(?<![\w/])#(\d+)\b/g;

function patternsFor(kind: TicketProviderKind): RegExp[] {
  switch (kind) {
    case 'github-issues':
      return [GITHUB_REF];
    case 'jira':
    case 'linear':
      return [JIRA_REF];
    default:
      return [JIRA_REF, GITHUB_REF];
  }
}

export function detectTicketRefs(prompt: string, kind: TicketProviderKind): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const pattern of patternsFor(kind)) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(prompt)) !== null) {
      const ref = match[0];
      if (!seen.has(ref)) {
        seen.add(ref);
        out.push(ref);
      }
    }
  }
  return out;
}

const BRANCH_NUMBERS = /^(\d+(?:-\d+)*)(?=-|$)/;

export function parseBranchTickets(branch: string | null | undefined): string[] {
  if (!branch) return [];
  const leaf = branch.split('/').filter(Boolean).at(-1) ?? '';
  const out = detectTicketRefs(leaf, 'jira');
  const numbers = BRANCH_NUMBERS.exec(leaf);
  if (numbers) {
    for (const n of numbers[1].split('-')) {
      const ref = `#${Number(n)}`;
      if (!out.includes(ref)) out.push(ref);
    }
  }
  return out;
}

export function armIntakeNarration(refs: readonly string[]): string {
  if (refs.length === 0) return '';
  const first = refs[0];
  const list = refs.join(', ');
  return (
    `**▸ paqad** · detected a ticket reference (${list})\n` +
    `> Ground the work in the real ticket: run \`paqad-ai intake fetch ${first}\` ` +
    `so I build what it actually says, not a guess from the id.`
  );
}
