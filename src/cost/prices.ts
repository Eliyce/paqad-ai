import type { TokenUsage } from './transcript-usage.js';

export const PRICE_TABLE_DATE = '2026-10-19';
export const PRICE_TABLE_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing';

export const COST_BASIS = 'API-equivalent estimate';
export const COST_LABEL = 'estimate at API prices (API-equivalent on a Pro or Max plan)';
export const COST_PLAN_NOTE =
  'On a Pro or Max plan you pay a flat fee, not these prices. The figure is what the same tokens would cost on the API.';

export const NOT_COUNTED: readonly string[] = [
  'The fast mode premium',
  'The 1.1 times multiplier for US-only inference',
  'Batch discounts',
  'Tool fees charged on their own, such as web search',
  'Subagents that are not paqad agents, since paqad never sees their transcripts',
  "Tokens spent before the change's first record or after its seal",
];

export interface ModelPrice {
  input: number;
  cache_write_5m: number;
  cache_write_1h: number;
  cache_read: number;
  output: number;
}

export interface PriceEntry {
  model: string;
  prices: ModelPrice;
  above?: { tokens: number; prices: ModelPrice };
}

function price(
  input: number,
  cacheWrite5m: number,
  cacheWrite1h: number,
  cacheRead: number,
  output: number,
): ModelPrice {
  return {
    input,
    cache_write_5m: cacheWrite5m,
    cache_write_1h: cacheWrite1h,
    cache_read: cacheRead,
    output,
  };
}

const FABLE_5_1 = price(10, 12.5, 20, 0.25, 50);
const FABLE_5 = price(10, 12.5, 20, 1, 50);
const OPUS_4_5_TO_5 = price(5, 6.25, 10, 0.5, 25);
const OPUS_4_AND_4_1 = price(15, 18.75, 30, 1.5, 75);
const SONNET_4_TO_4_6 = price(3, 3.75, 6, 0.3, 15);

export const PRICE_TABLE: readonly PriceEntry[] = [
  { model: 'claude-fable-5-1', prices: FABLE_5_1 },
  { model: 'claude-fable-5', prices: FABLE_5 },
  { model: 'claude-mythos-5-1', prices: FABLE_5_1 },
  { model: 'claude-mythos-5', prices: FABLE_5 },
  { model: 'claude-opus-5-5', prices: price(4, 5, 8, 0.2, 20) },
  { model: 'claude-opus-5', prices: OPUS_4_5_TO_5 },
  { model: 'claude-opus-4-8', prices: OPUS_4_5_TO_5 },
  { model: 'claude-opus-4-7', prices: OPUS_4_5_TO_5 },
  { model: 'claude-opus-4-6', prices: OPUS_4_5_TO_5 },
  { model: 'claude-opus-4-5', prices: OPUS_4_5_TO_5 },
  { model: 'claude-opus-4-1', prices: OPUS_4_AND_4_1 },
  { model: 'claude-opus-4', prices: OPUS_4_AND_4_1 },
  { model: 'claude-sonnet-5-5', prices: price(2, 2.5, 4, 0.1, 10) },
  { model: 'claude-sonnet-5', prices: price(2, 2.5, 4, 0.2, 10) },
  { model: 'claude-sonnet-4-6', prices: SONNET_4_TO_4_6 },
  { model: 'claude-sonnet-4-5', prices: SONNET_4_TO_4_6 },
  { model: 'claude-sonnet-4', prices: SONNET_4_TO_4_6 },
  {
    model: 'claude-haiku-5-5',
    prices: price(0.1, 0.125, 0.2, 0.01, 0.5),
    above: { tokens: 100_000, prices: price(0.5, 0.625, 1, 0.05, 2.5) },
  },
  { model: 'claude-haiku-4-5', prices: price(1, 1.25, 2, 0.1, 5) },
  { model: 'claude-haiku-3-5', prices: price(0.8, 1, 1.6, 0.08, 4) },
];

const ALIASES: Readonly<Record<string, string>> = {
  'claude-3-5-haiku': 'claude-haiku-3-5',
  'claude-sonnet-4-0': 'claude-sonnet-4',
  'claude-opus-4-0': 'claude-opus-4',
};

const BY_MODEL: ReadonlyMap<string, PriceEntry> = new Map(
  PRICE_TABLE.map((entry) => [entry.model, entry]),
);

export function normalizeModelId(model: string): string {
  let id = model.trim().toLowerCase();
  const at = id.indexOf('claude-');
  if (at > 0) id = id.slice(at);
  id = id.replace(/\[[^\]]*\]$/, '');
  id = id.replace(/-v\d+(?::\d+)?$/, '');
  id = id.replace(/(?:-|@)\d{8}$/, '');
  id = id.replace(/-latest$/, '');
  return ALIASES[id] ?? id;
}

export function priceFor(model: string | null | undefined): PriceEntry | null {
  if (typeof model !== 'string' || model.trim() === '') return null;
  return BY_MODEL.get(normalizeModelId(model)) ?? null;
}

export function messageUsd(usage: TokenUsage, model: string | null | undefined): number | null {
  const entry = priceFor(model);
  if (!entry) return null;
  const prompt = usage.input + usage.cache_read + usage.cache_write;
  const prices = entry.above && prompt > entry.above.tokens ? entry.above.prices : entry.prices;
  const write1h = usage.cache_write_1h;
  const write5m = Math.max(0, usage.cache_write - write1h);
  const dollars =
    usage.input * prices.input +
    write5m * prices.cache_write_5m +
    write1h * prices.cache_write_1h +
    usage.cache_read * prices.cache_read +
    usage.output * prices.output;
  return dollars / 1_000_000;
}

export function roundUsd(usd: number): number {
  return Math.round(usd * 10_000) / 10_000;
}

export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.005) return 'under $0.01';
  return `$${usd.toFixed(2)}`;
}

export function moneyText(usd: number, priceDate: string = PRICE_TABLE_DATE): string {
  return `~${formatUsd(usd)}, ${COST_LABEL}, prices of ${priceDate}`;
}
