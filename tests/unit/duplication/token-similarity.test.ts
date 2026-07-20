import { describe, expect, it } from 'vitest';

import {
  jaccard,
  shingles,
  tokenShingleSimilarity,
  tokenizeCode,
} from '@/duplication/token-similarity.js';

describe('tokenizeCode', () => {
  it('lowercases identifiers and keeps operators', () => {
    expect(tokenizeCode('const X = a + B;')).toEqual(['const', 'x', '=', 'a', '+', 'b', ';']);
  });

  it('drops line and block comments', () => {
    expect(tokenizeCode('a // trailing\n/* block */ b')).toEqual(['a', 'b']);
  });

  it('drops hash comments', () => {
    expect(tokenizeCode('run # note\ngo')).toEqual(['run', 'go']);
  });

  it('normalizes string, char, and template literal contents away', () => {
    const a = tokenizeCode('const s = "hello world";');
    const b = tokenizeCode('const s = "different text";');
    expect(a).toEqual(b);
  });

  it('returns an empty array for whitespace-only input', () => {
    expect(tokenizeCode('   \n\t ')).toEqual([]);
  });
});

describe('shingles', () => {
  it('produces one overlapping k-token shingle per window', () => {
    // 4 tokens, window 2 → 3 overlapping windows.
    expect(shingles(['a', 'b', 'c', 'd'], 2).size).toBe(3);
  });

  it('does not collide across different token boundaries', () => {
    // ['a','bc'] and ['ab','c'] must not both map to the same shingle.
    const left = shingles(['a', 'bc'], 2);
    const right = shingles(['ab', 'c'], 2);
    const [l] = left;
    const [r] = right;
    expect(l).not.toBe(r);
  });

  it('uses the whole stream as one shingle when shorter than the window', () => {
    expect(shingles(['a', 'b'], 4).size).toBe(1);
  });

  it('is empty for no tokens', () => {
    expect(shingles([], 3).size).toBe(0);
  });
});

describe('jaccard', () => {
  it('is 1 for identical sets', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
  });

  it('is 0 for disjoint sets', () => {
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
  });

  it('is 0 when either set is empty', () => {
    expect(jaccard(new Set(), new Set(['a']))).toBe(0);
    expect(jaccard(new Set(['a']), new Set())).toBe(0);
  });

  it('computes the overlap ratio', () => {
    // {a,b,c} vs {b,c,d}: intersection 2, union 4 → 0.5
    expect(jaccard(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd']))).toBe(0.5);
  });
});

describe('tokenShingleSimilarity', () => {
  it('scores identical code at 1', () => {
    const code = 'function f() {\n  return a + b + c + d;\n}';
    expect(tokenShingleSimilarity(code, code)).toBe(1);
  });

  it('scores a near-copy high and unrelated code low', () => {
    const original = 'function f() {\n  const x = a + b;\n  const y = c + d;\n  return x + y;\n}';
    const nearCopy = 'function g() {\n  const x = a + b;\n  const y = c + d;\n  return x + y;\n}';
    const unrelated = 'class Widget {\n  render() {\n    this.paint();\n  }\n}';
    expect(tokenShingleSimilarity(original, nearCopy)).toBeGreaterThan(0.7);
    expect(tokenShingleSimilarity(original, unrelated)).toBeLessThan(0.3);
  });
});
