import type { TicketProviderKind } from '@/core/types/project-profile.js';
import { DEFAULT_TRACKER_PATTERNS } from '@/git-workflow/defaults.js';

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

export interface TicketLink {
  tracker: TicketProviderKind;
  server: string;
  ref: string;
}

const JIRA_KEY = '[A-Z][A-Z0-9]+-\\d+';
const SERVICENOW_KEY = new RegExp(`\\b${DEFAULT_TRACKER_PATTERNS.servicenow}\\b`);
const SERVICENOW_KEYS = new RegExp(SERVICENOW_KEY.source, 'g');
const URL = /https?:\/\/[^\s<>()"'`]+/g;

const LINK_RULES: ReadonlyArray<{
  tracker: TicketProviderKind;
  pattern: RegExp;
  ref: (match: RegExpExecArray) => string;
}> = [
  {
    tracker: 'github-issues',
    pattern: /^https?:\/\/(github\.com)\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)/,
    ref: (match) => `${match[2]}/${match[3]}#${match[4]}`,
  },
  {
    tracker: 'linear',
    pattern: new RegExp(`^https?:\\/\\/(linear\\.app)\\/[\\w.-]+\\/issue\\/(${JIRA_KEY})`, 'i'),
    ref: (match) => match[2]!.toUpperCase(),
  },
  {
    tracker: 'jira',
    pattern: new RegExp(`^https?:\\/\\/([\\w.-]+)\\/browse\\/(${JIRA_KEY})\\b`),
    ref: (match) => match[2]!,
  },
  {
    tracker: 'jira',
    pattern: new RegExp(`^https?:\\/\\/([\\w-]+\\.atlassian\\.net)\\/\\S*?\\b(${JIRA_KEY})\\b`),
    ref: (match) => match[2]!,
  },
  {
    tracker: 'servicenow',
    pattern: new RegExp(
      `^https?:\\/\\/([\\w-]+\\.service-now\\.com)\\/\\S*?(${DEFAULT_TRACKER_PATTERNS.servicenow})`,
    ),
    ref: (match) => match[2]!,
  },
];

export function detectTicketLinks(text: string): TicketLink[] {
  const out: TicketLink[] = [];
  for (const [url] of text.matchAll(URL)) {
    for (const rule of LINK_RULES) {
      const match = rule.pattern.exec(url);
      if (match) {
        out.push({ tracker: rule.tracker, server: match[1]!.toLowerCase(), ref: rule.ref(match) });
        break;
      }
    }
  }
  if (out.length > 0) return out;
  for (const [ref] of text.matchAll(SERVICENOW_KEYS)) {
    out.push({ tracker: 'servicenow', server: '', ref });
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
