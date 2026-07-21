// Symbol-name similarity (issue #361).
//
// The evidence-armed decision pause needs to answer "is this planned new construct really a
// near-copy of something that already exists?" from names alone, deterministically and offline.
// Raw edit distance is not enough on its own: `formatRelativeDate` vs `formatIsoDate` is only
// 0.61 by Levenshtein, far below any threshold that would not also fire on unrelated names.
// What actually signals a reuse fork is TOKEN agreement — same verb, same noun, different
// qualifier — so the score is token-first with edit distance as the fallback leg.
//
// Everything here is pure and allocation-light; it runs once per planned new construct against
// the index's symbol list, so it must stay cheap (RULE-7).

import { levenshtein } from '@/module-decisions/schema.js';

/** Both first tokens agree (same verb) — the strongest single reuse signal. */
const HEAD_BONUS = 0.1;

/** Both last tokens agree (same noun) — the second strongest. */
const TAIL_BONUS = 0.1;

/** Both symbols are owned by the same module — a weak corroborating signal. */
const MODULE_BONUS = 0.05;

/**
 * Split an identifier into lowercase word tokens on camelCase, `_`, `-`, and digit
 * boundaries. `formatRelativeDate` → `['format','relative','date']`; `format_iso_date` →
 * `['format','iso','date']`, so naming style never changes the score.
 */
export function tokenizeSymbolName(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2')
    .split(/[^A-Za-z0-9]+/u)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());
}

/** Sørensen–Dice coefficient over two token sets, in `[0, 1]`. */
function tokenDice(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const rightSet = new Set(right);
  const shared = new Set(left.filter((token) => rightSet.has(token))).size;
  return (2 * shared) / (new Set(left).size + new Set(right).size);
}

/**
 * Normalized edit distance in `[0, 1]`, using the bounded `levenshtein` the module-slug and
 * reuse-symbol matchers already share rather than a second implementation (RULE-13). The
 * bound is the longer name's length, so the distance is always exact here.
 */
function editSimilarity(left: string, right: string): number {
  const longest = Math.max(left.length, right.length);
  if (longest === 0) {
    return 0;
  }
  return 1 - levenshtein(left, right, longest) / longest;
}

export interface SymbolSimilarityOptions {
  /** True when both symbols are owned by the same module slug. */
  sameModule?: boolean;
}

/**
 * How similar two symbol names are, in `[0, 1]` rounded to two decimals.
 *
 * The score is the better of the token reading and the edit-distance reading, plus a small
 * bonus when both symbols live in the same module:
 *
 * - token reading — Dice over the tokens, `+0.1` when the first tokens agree, `+0.1` when the
 *   last tokens agree. This is what catches `formatRelativeDate` ≈ `formatIsoDate` (0.87).
 * - edit reading — normalized Levenshtein. This is what catches a near-identical name whose
 *   tokenization differs, such as `formatRange` ≈ `formatRanges` (0.92).
 *
 * Deliberately calibrated so that head-OR-tail agreement alone is not enough: `readFeaturePlan`
 * vs `writeFeaturePlan` scores 0.77 and stays below the 0.85 default threshold, because two
 * functions that read and write the same thing are not a reuse fork.
 */
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
