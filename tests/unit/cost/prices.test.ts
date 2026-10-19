import { describe, expect, it } from 'vitest';

import {
  COST_LABEL,
  NOT_COUNTED,
  PRICE_TABLE,
  PRICE_TABLE_DATE,
  PRICE_TABLE_SOURCE,
  formatUsd,
  messageUsd,
  moneyText,
  normalizeModelId,
  priceFor,
  roundUsd,
} from '@/cost/prices.js';
import { emptyTokenUsage, type TokenUsage } from '@/cost/transcript-usage.js';

// Issue #639, Part 23 (FR-21, INV-10): the dated API price table shipped in paqad, copied from
// the public pricing page on 2026-10-19. Money is an estimate with its date; an unlisted model
// gets no price.

function usage(over: Partial<TokenUsage>): TokenUsage {
  const base = { ...emptyTokenUsage(), ...over };
  return { ...base, total: base.input + base.output + base.cache_read + base.cache_write };
}

const MILLION = 1_000_000;

describe('the price table', () => {
  it('is dated and names its source', () => {
    expect(PRICE_TABLE_DATE).toBe('2026-10-19');
    expect(PRICE_TABLE_SOURCE).toBe('https://platform.claude.com/docs/en/about-claude/pricing');
  });

  it('holds the published prices per million tokens', () => {
    const row = (model: string) => {
      const entry = PRICE_TABLE.find((e) => e.model === model)!;
      const p = entry.prices;
      return [p.input, p.cache_write_5m, p.cache_write_1h, p.cache_read, p.output];
    };
    expect(row('claude-fable-5-1')).toEqual([10, 12.5, 20, 0.25, 50]);
    expect(row('claude-fable-5')).toEqual([10, 12.5, 20, 1, 50]);
    expect(row('claude-mythos-5-1')).toEqual([10, 12.5, 20, 0.25, 50]);
    expect(row('claude-mythos-5')).toEqual([10, 12.5, 20, 1, 50]);
    expect(row('claude-opus-5-5')).toEqual([4, 5, 8, 0.2, 20]);
    expect(row('claude-opus-5')).toEqual([5, 6.25, 10, 0.5, 25]);
    for (const model of [
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-opus-4-5',
    ]) {
      expect(row(model)).toEqual([5, 6.25, 10, 0.5, 25]);
    }
    expect(row('claude-opus-4-1')).toEqual([15, 18.75, 30, 1.5, 75]);
    expect(row('claude-opus-4')).toEqual([15, 18.75, 30, 1.5, 75]);
    expect(row('claude-sonnet-5-5')).toEqual([2, 2.5, 4, 0.1, 10]);
    expect(row('claude-sonnet-5')).toEqual([2, 2.5, 4, 0.2, 10]);
    for (const model of ['claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-sonnet-4']) {
      expect(row(model)).toEqual([3, 3.75, 6, 0.3, 15]);
    }
    expect(row('claude-haiku-5-5')).toEqual([0.1, 0.125, 0.2, 0.01, 0.5]);
    const haiku = PRICE_TABLE.find((e) => e.model === 'claude-haiku-5-5')!.above!;
    expect(haiku.tokens).toBe(100_000);
    expect(Object.values(haiku.prices)).toEqual([0.5, 0.625, 1, 0.05, 2.5]);
    expect(row('claude-haiku-4-5')).toEqual([1, 1.25, 2, 0.1, 5]);
    expect(row('claude-haiku-3-5')).toEqual([0.8, 1, 1.6, 0.08, 4]);
  });

  it('lists what the estimate does not count', () => {
    expect(NOT_COUNTED.join(' ')).toMatch(/fast mode premium/);
    expect(NOT_COUNTED.join(' ')).toMatch(/US-only inference/);
    expect(NOT_COUNTED.join(' ')).toMatch(/Batch discounts/);
    expect(NOT_COUNTED.join(' ')).toMatch(/before the change's first record or after its seal/);
  });
});

describe('matching a model id', () => {
  it.each([
    ['claude-opus-5-5', 'claude-opus-5-5'],
    ['claude-opus-5-5[1m]', 'claude-opus-5-5'],
    ['claude-haiku-4-5-20251001', 'claude-haiku-4-5'],
    ['claude-opus-4-1-20250805', 'claude-opus-4-1'],
    ['claude-sonnet-4-20250514', 'claude-sonnet-4'],
    ['claude-3-5-haiku-20241022', 'claude-haiku-3-5'],
    ['us.anthropic.claude-sonnet-4-5-20250929-v1:0', 'claude-sonnet-4-5'],
    ['claude-opus-4-5@20251101', 'claude-opus-4-5'],
    ['claude-sonnet-5-latest', 'claude-sonnet-5'],
    ['CLAUDE-FABLE-5-1', 'claude-fable-5-1'],
  ])('%s reads as %s', (id, model) => {
    expect(normalizeModelId(id)).toBe(model);
    expect(priceFor(id)?.model).toBe(model);
  });

  it('gives no price to a model the table does not list', () => {
    expect(priceFor('claude-future-9')).toBeNull();
    expect(priceFor('<synthetic>')).toBeNull();
    expect(priceFor(null)).toBeNull();
    expect(priceFor('  ')).toBeNull();
    expect(messageUsd(usage({ input: MILLION }), 'gpt-9')).toBeNull();
  });
});

describe('money', () => {
  it('AC-51: 1M input and 1M output on Opus 5.5 is 24.00 USD, labelled estimate', () => {
    const usd = messageUsd(usage({ input: MILLION, output: MILLION }), 'claude-opus-5-5')!;
    expect(roundUsd(usd)).toBe(24);
    expect(formatUsd(usd)).toBe('$24.00');
    const text = moneyText(usd);
    expect(text).toBe(
      '~$24.00, estimate at API prices (API-equivalent on a Pro or Max plan), prices of 2026-10-19',
    );
    expect(text).toContain('estimate');
    expect(text).toContain(COST_LABEL);
  });

  it('prices cache writes by lifetime, and an unsplit write as 5 minutes', () => {
    const split = usage({ cache_write: MILLION, cache_write_5m: 400_000, cache_write_1h: 600_000 });
    expect(messageUsd(split, 'claude-opus-5-5')).toBeCloseTo(0.4 * 5 + 0.6 * 8);
    const unsplit = usage({ cache_write: MILLION });
    expect(messageUsd(unsplit, 'claude-opus-5-5')).toBeCloseTo(5);
    expect(messageUsd(usage({ cache_read: MILLION }), 'claude-opus-5-5')).toBeCloseTo(0.2);
  });

  it('prices Haiku 5.5 by prompt size, the higher tier above 100,000 prompt tokens', () => {
    const small = usage({ input: 100_000, output: MILLION });
    expect(messageUsd(small, 'claude-haiku-5-5')).toBeCloseTo(0.01 + 0.5);
    const large = usage({ input: 60_000, cache_read: 40_001, output: MILLION });
    expect(messageUsd(large, 'claude-haiku-5-5')).toBeCloseTo(
      (60_000 * 0.5 + 40_001 * 0.05 + MILLION * 2.5) / MILLION,
    );
  });

  it('says a sliver as under a cent and rounds a stored sum', () => {
    expect(formatUsd(0.0001)).toBe('under $0.01');
    expect(formatUsd(0)).toBe('$0.00');
    expect(roundUsd(0.123456)).toBe(0.1235);
    expect(moneyText(1.5, '2026-01-01')).toContain('prices of 2026-01-01');
  });
});
