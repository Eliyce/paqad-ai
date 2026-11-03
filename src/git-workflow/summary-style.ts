import { firstLine, ticketPatterns } from './patterns.js';
import type { ResolvedGitWorkflow } from './types.js';

const FILE_PATH = /\b[\w.-]+\/[\w./-]+\b/;
const FILE_NAME =
  /\b\w+\.(ts|tsx|js|jsx|php|py|rb|go|java|kt|cs|vue|css|scss|sql|yml|yaml|json|md)\b/;
const CODE_SYMBOLS = ['::', '->', '=>', '()'];
const CAMEL = /[a-z][A-Z]/;
const SNAKE = /[A-Za-z]_[A-Za-z]/;
const VAGUE = new Set([
  'fix',
  'fixes',
  'fix bug',
  'fix bugs',
  'bug fix',
  'bugfix',
  'update',
  'updates',
  'change',
  'changes',
  'wip',
  'misc',
  'minor changes',
  'cleanup',
  'refactor',
  'tweaks',
  'small fixes',
]);

export const IGNORED_SUBJECT = /^(Merge |Revert "|fixup! |squash! )/;

export function isIgnoredSubject(subject: string): boolean {
  return IGNORED_SUBJECT.test(subject);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ticketRegExps(config: ResolvedGitWorkflow): RegExp[] {
  return Object.values(config.tickets.sources).flatMap((source) => {
    try {
      return [new RegExp(source.pattern, 'g')];
    } catch {
      return [];
    }
  });
}

const SUMMARY_PIECES: Readonly<Record<string, string>> = {
  ticket: '[^\\s()\\[\\]:]*',
  scope: '[^()\\s]*',
  prefix: '[^/\\s]*',
  title: '.*?',
  title_slug: '[a-z0-9-]*',
  tech_debt: '[\\s\\S]*?',
};

export function summaryPart(
  subject: string,
  template: string,
  config: ResolvedGitWorkflow,
): string {
  const line = firstLine(template);
  if (line.includes('{summary}')) {
    const types = Object.values(config.branches.types).map((type) =>
      escapeRegExp(type.commit_type),
    );
    const typePiece = types.length > 0 ? `(?:${types.join('|')})` : '\\w+';
    const tickets = ticketPatterns(config);
    const ticketPiece =
      tickets.length > 0 ? `(?:${tickets.map((pattern) => `(?:${pattern})`).join('|')})?` : '';
    const source = line
      .split(/(\{[a-z_]+\})/)
      .map((part) => {
        const key = /^\{([a-z_]+)\}$/.exec(part)?.[1];
        if (key === 'summary') return '(?<summary>.+?)';
        if (key === 'type') return typePiece;
        if (key === 'ticket') return ticketPiece;
        if (key && SUMMARY_PIECES[key]) return SUMMARY_PIECES[key];
        return escapeRegExp(part).replace(/[ :([\]\\)]+/g, (sep) => `(?:${sep})?`);
      })
      .join('');
    const match = new RegExp(`^${source}$`).exec(subject);
    const summary = match?.groups?.summary;
    if (summary !== undefined) return withoutTickets(summary, config);
  }
  return withoutTickets(subject, config);
}

function withoutTickets(text: string, config: ResolvedGitWorkflow): string {
  let out = text;
  for (const pattern of ticketRegExps(config)) out = out.replace(pattern, '');
  return out.replace(/\s{2,}/g, ' ').trim();
}

export function summaryStyleReasons(summary: string, maxLength: number): string[] {
  const reasons: string[] = [];
  if (summary.includes('`')) reasons.push('it contains code formatting');
  if (FILE_PATH.test(summary) || FILE_NAME.test(summary)) reasons.push('it names a file');
  if (CODE_SYMBOLS.some((symbol) => summary.includes(symbol))) {
    reasons.push('it uses code symbols');
  }
  const words = summary.split(/\s+/).filter((word) => word !== '');
  if (words.some((word) => CAMEL.test(word) || SNAKE.test(word))) {
    reasons.push('it names a function or variable');
  }
  if (summary.length > maxLength) reasons.push(`it's longer than ${maxLength} characters`);
  const normalized = summary
    .toLowerCase()
    .replace(/[.!?,;:]+$/, '')
    .trim();
  if (VAGUE.has(normalized)) {
    reasons.push("it doesn't say what changed");
  } else if (words.length < 3) {
    reasons.push("it's too short to say what changed");
  }
  const first = (words[0] ?? '').replace(/[^A-Za-z]/g, '');
  if (first.length > 4 && first.toLowerCase().endsWith('ing')) {
    reasons.push('start with what it does, like "Show", not "Showing"');
  }
  return reasons;
}

export function checkSummaryStyle(
  subject: string,
  template: string,
  config: ResolvedGitWorkflow,
): string[] {
  if (config.commits.summary.style !== 'plain' || isIgnoredSubject(subject)) return [];
  return summaryStyleReasons(
    summaryPart(subject, template, config),
    config.commits.summary.max_length,
  );
}

export function summaryStyleMessage(subject: string, reason: string, what = 'commit'): string {
  return `${what} "${subject}" reads like code, not plain language: ${reason}.`;
}
