import { builtinSecretScan } from '@/codebase-health/gather.js';

export type LintSeverity = 'block' | 'warn';

export interface LintFinding {
  rule: string;
  severity: LintSeverity;
  file: string;
  line: number;
  message: string;
  fingerprint?: string;
}

export interface LintResult {
  findings: LintFinding[];
  blocking: number;
  warnings: number;
}

export interface LintTextFile {
  rel: string;
  lines: readonly string[];
}

export class FindingSink {
  readonly findings: LintFinding[] = [];

  add(rule: string, severity: LintSeverity, file: string, line: number, message: string) {
    this.findings.push({ rule, severity, file, line, message });
  }

  block(rule: string, file: string, line: number, message: string) {
    this.add(rule, 'block', file, line, message);
  }

  warn(rule: string, file: string, line: number, message: string) {
    this.add(rule, 'warn', file, line, message);
  }
}

export const EM_DASH = '—';
export const SHOUTED = /\b(ALWAYS|NEVER|MUST|CRITICAL)\b/;
export const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/;
export const CLOCK_TIME = /\b\d{1,2}:\d{2}:\d{2}\b/;
export const DYNAMIC_PLACEHOLDER =
  /\{\{\s*(?:now|date|time|timestamp|today|counter|random|uuid)\s*\}\}/i;
export const COUNTER = /\b(?:run|iteration|attempt|build|request)\s*(?:#|no\.?\s*)\d+\b/i;

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sortFindings<T extends LintFinding>(findings: T[]): T[] {
  return findings.sort(
    (left, right) =>
      compareText(left.file, right.file) ||
      left.line - right.line ||
      compareText(left.rule, right.rule) ||
      compareText(left.message, right.message),
  );
}

export function countFindings(findings: readonly LintFinding[]): {
  blocking: number;
  warnings: number;
} {
  const blocking = findings.filter((finding) => finding.severity === 'block').length;
  return { blocking, warnings: findings.length - blocking };
}

export function lintExitCode(result: { blocking: number }): 0 | 1 {
  return result.blocking > 0 ? 1 : 0;
}

export function formatLintJson(result: unknown): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function checkEmDash(sink: FindingSink, rule: string, file: LintTextFile): void {
  file.lines.forEach((text, index) => {
    if (text.includes(EM_DASH)) {
      sink.block(
        rule,
        file.rel,
        index + 1,
        'An em dash (U+2014). Use a comma, a colon or two sentences.',
      );
    }
  });
}

export function checkNeverWrite(
  sink: FindingSink,
  rule: string,
  file: LintTextFile,
  neverWrite: RegExp,
): void {
  file.lines.forEach((text, index) => {
    neverWrite.lastIndex = 0;
    for (const match of text.matchAll(neverWrite)) {
      const phrase = match[0].toLowerCase().replace(/\s+/g, ' ');
      sink.block(rule, file.rel, index + 1, `Generic phrase "${phrase}". Say what it means here.`);
    }
  });
}

export function checkShouted(sink: FindingSink, rule: string, file: LintTextFile): void {
  file.lines.forEach((text, index) => {
    const shouted = SHOUTED.exec(text);
    if (shouted) {
      sink.block(
        rule,
        file.rel,
        index + 1,
        `"${shouted[1]}" in capitals. Say why instead of shouting.`,
      );
    }
  });
}

export interface DynamicCheckOptions {
  firstLine: number;
  exempt?: RegExp;
  extraPatterns?: readonly RegExp[];
  message: string;
}

export function checkDynamic(
  sink: FindingSink,
  rule: string,
  file: LintTextFile,
  options: DynamicCheckOptions,
): void {
  const patterns = [
    ISO_DATE,
    CLOCK_TIME,
    DYNAMIC_PLACEHOLDER,
    COUNTER,
    ...(options.extraPatterns ?? []),
  ];
  file.lines.forEach((text, index) => {
    const line = index + 1;
    if (line < options.firstLine || options.exempt?.test(text) === true) return;
    if (patterns.some((pattern) => pattern.test(text))) {
      sink.block(rule, file.rel, line, options.message);
    }
  });
}

export function checkSecrets(
  sink: FindingSink,
  rule: string,
  files: ReadonlyArray<{ path: string; content: string }>,
): void {
  for (const match of builtinSecretScan([...files])) {
    sink.findings.push({
      rule,
      severity: 'block',
      file: match.file,
      line: match.line,
      message: `A secret (${match.rule}) is in this file, fingerprint ${match.fingerprint}. Remove it; a secret can never be approved.`,
      fingerprint: match.fingerprint,
    });
  }
}
