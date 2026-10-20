import { levenshtein } from '@/module-decisions/schema.js';

const HEAD_BONUS = 0.1;

const TAIL_BONUS = 0.1;

const MODULE_BONUS = 0.05;

export function tokenizeSymbolName(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2')
    .split(/[^A-Za-z0-9]+/u)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());
}

function tokenDice(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const rightSet = new Set(right);
  const shared = new Set(left.filter((token) => rightSet.has(token))).size;
  return (2 * shared) / (new Set(left).size + new Set(right).size);
}

function editSimilarity(left: string, right: string): number {
  const longest = Math.max(left.length, right.length);
  if (longest === 0) {
    return 0;
  }
  return 1 - levenshtein(left, right, longest) / longest;
}

export interface SymbolSimilarityOptions {
  sameModule?: boolean;
}

export function symbolNameSimilarity(
  left: string,
  right: string,
  options: SymbolSimilarityOptions = {},
): number {
  if (left === right) {
    return 1;
  }
  const leftTokens = tokenizeSymbolName(left);
  const rightTokens = tokenizeSymbolName(right);

  let tokenScore = tokenDice(leftTokens, rightTokens);
  if (tokenScore > 0) {
    if (leftTokens[0] === rightTokens[0]) {
      tokenScore += HEAD_BONUS;
    }
    if (leftTokens[leftTokens.length - 1] === rightTokens[rightTokens.length - 1]) {
      tokenScore += TAIL_BONUS;
    }
  }

  const base = Math.max(tokenScore, editSimilarity(left, right));
  const withModule = base + (options.sameModule === true ? MODULE_BONUS : 0);
  return Number(Math.min(1, Math.max(0, withModule)).toFixed(2));
}
