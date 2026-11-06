import type { DesignFormat } from '@/git-workflow/types.js';

import { findJargon } from './jargon.js';

export type HldRule =
  'summary-length' | 'detail-length' | 'missing-section' | 'code' | 'jargon' | 'em-dash';

export interface HldFinding {
  line: number;
  rule: HldRule;
  message: string;
}

export interface HldCheckResult {
  ok: boolean;
  summary_words: number;
  detail_words: number;
  findings: HldFinding[];
}

export const REQUIRED_SECTIONS = [
  'In one line',
  'What changes for the user',
  'Choices we made',
  'To approve',
] as const;

const DIVIDER = /^---$/u;
const LINK = /https?:\/\/[^\s<>()]+/gu;
const ARROWS = new Set(['→', '->', '=>']);
const EM_DASH = '—';

const CODE_RULES: ReadonlyArray<{ pattern: RegExp; what: (found: string) => string }> = [
  { pattern: /`/u, what: () => 'a backtick' },
  {
    pattern: /(?:^|[\s(])(?:\.{0,2}\/)?src\/\S*/u,
    what: (found) => `a file path (${found.trim()})`,
  },
  {
    pattern: /[\w.-]*\/[\w./-]*\.[A-Za-z][A-Za-z0-9]{0,5}\b/u,
    what: (found) => `a file path (${found})`,
  },
  { pattern: /\b[A-Za-z_][A-Za-z0-9_]*\(/u, what: (found) => `a function call (${found})` },
  { pattern: /\b[a-z]{2,}[A-Z][A-Za-z0-9]*\b/u, what: (found) => `a code name (${found})` },
  {
    pattern: /\b[A-Za-z0-9]+_[A-Za-z0-9_]*[A-Za-z0-9]\b/u,
    what: (found) => `a code name (${found})`,
  },
];

export function countWords(lines: readonly string[]): number {
  let count = 0;
  for (const raw of lines) {
    if (DIVIDER.test(raw.trim())) continue;
    const line = raw
      .replace(/\*+/gu, ' ')
      .replace(/^\s*#+\s*/u, '')
      .replace(/^\s*(?:[-+]|\d+[.)])\s+/u, '')
      .replace(/\|/gu, ' ');
    for (const token of line.split(/\s+/u)) {
      if (token === '' || ARROWS.has(token) || /^[-:]+$/u.test(token)) continue;
      count += 1;
    }
  }
  return count;
}

function splitAtDivider(lines: readonly string[]): {
  summary: string[];
  detail: string[];
  at: number;
} {
  const at = lines.findIndex((line) => DIVIDER.test(line));
  if (at < 0) return { summary: [...lines], detail: [], at: lines.length };
  return { summary: lines.slice(0, at), detail: lines.slice(at + 1), at };
}

export function checkHld(markdown: string, format: DesignFormat): HldCheckResult {
  const lines = markdown.replace(/\r\n/gu, '\n').split('\n');
  const { summary, detail, at } = splitAtDivider(lines);
  const findings: HldFinding[] = [];
  const summaryWords = countWords(summary);
  const detailWords = countWords(detail);

  if (summaryWords > format.summary_max_words) {
    findings.push({
      line: 1,
      rule: 'summary-length',
      message: `The summary above the --- line has ${summaryWords} words; keep it to ${format.summary_max_words}.`,
    });
  }
  if (detailWords > format.detail_max_words) {
    findings.push({
      line: Math.min(at + 2, lines.length),
      rule: 'detail-length',
      message: `The detail below the --- line has ${detailWords} words; keep it to ${format.detail_max_words}.`,
    });
  }
  const plain = lines.map((line) => line.replace(/\*+/gu, ''));
  for (const section of REQUIRED_SECTIONS) {
    if (!plain.some((line) => line.toLowerCase().includes(section.toLowerCase()))) {
      findings.push({
        line: 1,
        rule: 'missing-section',
        message: `The "${section}" section is missing.`,
      });
    }
  }

  lines.forEach((raw, index) => {
    const line = index + 1;
    if (raw.includes(EM_DASH)) {
      findings.push({
        line,
        rule: 'em-dash',
        message: 'There is an em dash. Use a comma, a full stop or "to" instead.',
      });
    }
    const text = raw.replace(LINK, ' ');
    for (const rule of CODE_RULES) {
      const match = rule.pattern.exec(text);
      if (match) {
        findings.push({
          line,
          rule: 'code',
          message: `There is ${rule.what(match[0])}. Describe it in plain words instead.`,
        });
        break;
      }
    }
    for (const hit of findJargon(text)) {
      findings.push({
        line,
        rule: 'jargon',
        message: `"${hit.found}" is jargon. Say "${hit.entry.plain}" instead.`,
      });
    }
  });

  findings.sort((a, b) => a.line - b.line);
  return {
    ok: findings.length === 0,
    summary_words: summaryWords,
    detail_words: detailWords,
    findings,
  };
}

export function formatHldFindings(result: HldCheckResult): string[] {
  return result.findings.map((finding) => `line ${finding.line}: ${finding.message}`);
}
