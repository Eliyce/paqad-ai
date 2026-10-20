import { describe, expect, it } from 'vitest';

import { symbolNameSimilarity, tokenizeSymbolName } from '@/planning/symbol-similarity.js';

describe('tokenizeSymbolName', () => {
  it('splits camelCase into lowercase word tokens', () => {
    expect(tokenizeSymbolName('formatRelativeDate')).toEqual(['format', 'relative', 'date']);
  });

  it('splits an acronym run at the word boundary', () => {
    expect(tokenizeSymbolName('parseHTMLNode')).toEqual(['parse', 'html', 'node']);
  });

  it('treats snake_case, kebab-case, and digits the same as camelCase', () => {
    expect(tokenizeSymbolName('format_iso_date')).toEqual(['format', 'iso', 'date']);
    expect(tokenizeSymbolName('format-iso-date')).toEqual(['format', 'iso', 'date']);
    expect(tokenizeSymbolName('formatIso2Date')).toEqual(['format', 'iso2', 'date']);
  });

  it('yields nothing for a name with no word characters', () => {
    expect(tokenizeSymbolName('__')).toEqual([]);
  });
});

describe('symbolNameSimilarity', () => {
  it('scores an identical name 1', () => {
    expect(symbolNameSimilarity('formatIsoDate', 'formatIsoDate')).toBe(1);
  });

  it('scores a same-verb same-noun fork above the 0.85 default threshold', () => {
    expect(symbolNameSimilarity('formatRelativeDate', 'formatIsoDate')).toBe(0.87);
  });

  it('adds the same-module bonus', () => {
    expect(symbolNameSimilarity('formatRelativeDate', 'formatIsoDate', { sameModule: true })).toBe(
      0.92,
    );
  });

  it('keeps a read/write pair below the threshold even in the same module', () => {
    expect(symbolNameSimilarity('readFeaturePlan', 'writeFeaturePlan')).toBe(0.77);
    expect(symbolNameSimilarity('readFeaturePlan', 'writeFeaturePlan', { sameModule: true })).toBe(
      0.82,
    );
  });

  it('catches a near-identical name the token reading would miss', () => {
    expect(symbolNameSimilarity('formatRange', 'formatRanges')).toBe(0.92);
  });

  it('treats naming style as irrelevant', () => {
    expect(symbolNameSimilarity('format_iso_date', 'formatIsoDate')).toBe(1);
  });

  it('scores unrelated names low', () => {
    expect(symbolNameSimilarity('symbolNameSimilarity', 'assembleDecisionEvidence')).toBeLessThan(
      0.5,
    );
  });

  it('scores a nameless pair 0 rather than throwing', () => {
    expect(symbolNameSimilarity('__', '--')).toBe(0);
  });

  it('never exceeds 1 even with both bonuses and the module bonus', () => {
    expect(
      symbolNameSimilarity('formatDate', 'formatDates', { sameModule: true }),
    ).toBeLessThanOrEqual(1);
  });
});
