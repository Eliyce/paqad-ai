import type { DecisionPacket } from './decision-packet.js';

const BANNED_WORDS = [
  'abstraction',
  'polymorphic',
  'dry',
  'solid',
  'coupling',
  'cohesion',
  'encapsulation',
  'idiomatic',
  'refactor',
  'hoist',
  'monomorphic',
  'deterministic',
  'idempotent',
  'cardinality',
  'invariant',
  'predicate',
  'instantiation',
] as const;

export interface DecisionCopyIssue {
  field: string;
  message: string;
}

export function lintDecisionCopy(packet: DecisionPacket): DecisionCopyIssue[] {
  const issues: DecisionCopyIssue[] = [];

  if (wordCount(packet.question) > 15) {
    issues.push({ field: 'question', message: 'Question must be 15 words or fewer.' });
  }
  if (!isGrade8Friendly(packet.question)) {
    issues.push({ field: 'question', message: 'Question must stay at grade-8 readability.' });
  }

  checkBanned('question', packet.question, issues);
  if (packet.recommendation_reason) {
    checkBanned('recommendation_reason', packet.recommendation_reason, issues);
    if (!isGrade8Friendly(packet.recommendation_reason)) {
      issues.push({
        field: 'recommendation_reason',
        message: 'Recommendation reason must stay at grade-8 readability.',
      });
    }
  }

  for (const [index, option] of packet.options.entries()) {
    const prefix = `options[${index}]`;
    const labelWords = wordCount(option.label);
    if (labelWords < 2 || labelWords > 5) {
      issues.push({ field: `${prefix}.label`, message: 'Option label must be 2 to 5 words.' });
    }
    if (!startsWithVerb(option.label)) {
      issues.push({ field: `${prefix}.label`, message: 'Option label must start with a verb.' });
    }
    if (!/^if you pick this,/i.test(option.one_line_preview)) {
      issues.push({
        field: `${prefix}.one_line_preview`,
        message: 'One-line preview must start with "If you pick this,".',
      });
    }
    if (!/^You give up:\s/i.test(option.trade_off)) {
      issues.push({
        field: `${prefix}.trade_off`,
        message: 'Trade-off must start with "You give up:".',
      });
    }
    checkBanned(`${prefix}.label`, option.label, issues);
    checkBanned(`${prefix}.one_line_preview`, option.one_line_preview, issues);
    checkBanned(`${prefix}.trade_off`, option.trade_off, issues);
    if (!isGrade8Friendly(option.label)) {
      issues.push({
        field: `${prefix}.label`,
        message: 'Option label must stay at grade-8 readability.',
      });
    }
  }

  return issues;
}

function checkBanned(field: string, value: string, issues: DecisionCopyIssue[]): void {
  const normalized = value.toLowerCase();
  for (const banned of BANNED_WORDS) {
    if (normalized.includes(banned)) {
      issues.push({ field, message: `Banned word "${banned}" is not allowed here.` });
    }
  }
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function isGrade8Friendly(value: string): boolean {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => word.replace(/[^a-z]/gi, '').length <= 12);
}

function startsWithVerb(value: string): boolean {
  return /^(Reuse|Make|Keep|Extract|Take|Use|Switch|Stay|Skip|Pick)\b/i.test(value.trim());
}
