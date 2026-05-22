import { createHash } from 'node:crypto';

import type { ActiveCapability } from '@/core/types/domain.js';

import type { DecisionCategory } from './decision-packet.js';

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'for',
  'i',
  'is',
  'it',
  'of',
  'or',
  'should',
  'the',
  'this',
  'to',
  'we',
  'which',
  'you',
]);

const TOKEN_EQUIVALENTS: Record<string, string> = {
  choose: 'choose',
  pick: 'choose',
  use: 'choose',
};

export interface RepoStateSignatureInput {
  active_capabilities?: ActiveCapability[];
  stack?: string | null;
  packs?: string[];
}

export interface DecisionFingerprintInput {
  category: DecisionCategory;
  question: string;
  option_keys: string[];
  repo_state: RepoStateSignatureInput;
}

export function computeDecisionFingerprint(input: DecisionFingerprintInput): string {
  const payload = [
    input.category,
    normalizeDecisionQuestion(input.question),
    [...input.option_keys].sort().join('|'),
    buildRepoStateSignature(input.repo_state),
  ].join('::');

  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

export function normalizeDecisionQuestion(value: string): string {
  return tokenize(value)
    .map((token) => TOKEN_EQUIVALENTS[token] ?? token)
    .filter((token) => !STOP_WORDS.has(token))
    .sort()
    .join(' ');
}

export function buildRepoStateSignature(input: RepoStateSignatureInput): string {
  return JSON.stringify({
    active_capabilities: [...(input.active_capabilities ?? [])].sort(),
    packs: [...(input.packs ?? [])].sort(),
    stack: input.stack ?? null,
  });
}

export function scoreDecisionOptionOverlap(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (union.size === 0) {
    return 1;
  }

  let intersection = 0;
  for (const value of leftSet) {
    if (rightSet.has(value)) {
      intersection += 1;
    }
  }

  return intersection / union.size;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}
