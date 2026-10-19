// What the change cost, in words (issue #639, Part 23): the band's cost pill, the Cost tab and
// `/paqad cost`.
//
// Pure: no Claude Code import and nothing from `model.ts`, so vitest tests it without the host
// and `model.ts` can use it without an import cycle. Every money figure carries the word
// estimate and the price table's date, wherever it is drawn (INV-10). A model the price table
// does not list adds its tokens and no money.

import type { PaqadCost, PaqadCostLine, PaqadCostTokens } from './types';

/** A token count as the band says it: `812`, `45.3k`, `1.2M`. */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(Math.max(0, Math.round(tokens)));
}

/** A token count in full, with thousands separators: `1,234,567`. */
export function fullTokens(tokens: number): string {
  return Math.max(0, Math.round(tokens))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** A dollar figure: `$3.40`, or `under $0.01` for a non-zero sliver. */
export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.005) return 'under $0.01';
  return `$${usd.toFixed(2)}`;
}

/** A money figure with the word estimate and the price date, the short form. */
export function moneyShort(usd: number, priceDate: string): string {
  return `~${formatUsd(usd)} estimate, ${priceDate} prices`;
}

/** The band's cost pill: tokens and money, tokens only when nothing is priced, or "not yet". */
export function costPill(cost: PaqadCost | null): string {
  if (!cost) return 'cost: not yet';
  const tokens = `${formatTokens(cost.tokens.total)} tokens`;
  if (cost.usd === null) return tokens;
  const partial = cost.unpriced_models.length > 0 ? ', part unpriced' : '';
  return `${tokens}, ${moneyShort(cost.usd, cost.price_table_date)}${partial}`;
}

function lineText(line: PaqadCostLine, priceDate: string): string {
  const tokens = `${formatTokens(line.tokens.total)} tokens`;
  return line.usd === null ? tokens : `${tokens}, ${moneyShort(line.usd, priceDate)}`;
}

function tokenKinds(tokens: PaqadCostTokens): string {
  return [
    `${fullTokens(tokens.input)} input`,
    `${fullTokens(tokens.output)} output`,
    `${fullTokens(tokens.cache_read)} cache read`,
    `${fullTokens(tokens.cache_write)} cache write`,
  ].join(', ');
}

/** A role id in words: `security-auditor` reads `Security auditor`. */
export function roleWords(role: string): string {
  const words = role.replace(/[-_]+/g, ' ').trim();
  return words ? `${words[0]!.toUpperCase()}${words.slice(1)}` : role;
}

export interface CostLinesOptions {
  /** The change's lane: the fast lane seats no High Table. */
  lane: string | null;
  /** A stage id in the band's words (`development` reads `Build`). */
  stageLabel: (stage: string) => string;
}

function expertLines(cost: PaqadCost, options: CostLinesOptions): string[] {
  const date = cost.price_table_date;
  if (cost.by_expert.length === 0 && cost.chief === null) {
    return [
      options.lane === 'fast'
        ? 'By expert: none. The fast lane seats no High Table.'
        : 'By expert: none. No High Table seat has reported tokens.',
    ];
  }
  const lines = ['By expert:'];
  for (const seat of cost.by_expert) {
    lines.push(
      seat.exact
        ? `  ${roleWords(seat.role)}: ${lineText(seat, date)}`
        : `  ${roleWords(seat.role)}: about ${formatTokens(seat.tokens.total)} tokens, the seat's own estimate, already inside the total`,
    );
  }
  if (cost.chief) {
    lines.push(
      cost.chief.exact
        ? `Chief architect: ${lineText(cost.chief, date)}`
        : `Chief architect: about ${formatTokens(cost.chief.tokens.total)} tokens, its own estimate, already inside the total`,
    );
  } else {
    lines.push('Chief architect: no tokens reported yet.');
  }
  return lines;
}

/**
 * The whole cost in plain words, for the Cost tab and `/paqad cost`: the total, by stage, by
 * expert and the chief, the basis, what has no price and what is not counted.
 */
export function costLines(cost: PaqadCost, options: CostLinesOptions): string[] {
  const date = cost.price_table_date;
  const money =
    cost.usd === null
      ? 'no money figure, since no model it used is in the price table'
      : `~${formatUsd(cost.usd)}, ${cost.label}, prices of ${date}`;
  const lines = [
    `Cost of this change: ${fullTokens(cost.tokens.total)} tokens, ${money}.`,
    `Tokens: ${tokenKinds(cost.tokens)}.`,
    cost.sealed
      ? 'Counted from the first record to the seal.'
      : 'Counted so far: the change is not sealed yet.',
    'By stage:',
    ...(cost.by_stage.length === 0
      ? ['  none yet']
      : cost.by_stage.map(
          (line) => `  ${options.stageLabel(line.stage)}: ${lineText(line, date)}`,
        )),
    ...expertLines(cost, options),
    `Basis: ${cost.basis}. Tokens come from the session's own transcripts; money is tokens times the published API price on ${date}. ${cost.plan_note}`,
  ];
  if (cost.unpriced_models.length > 0) {
    lines.push(
      `No price for ${cost.unpriced_models.join(', ')}: its tokens are in the total, its money is not.`,
    );
  }
  lines.push(`Not counted: ${cost.not_counted.join('; ')}.`);
  return lines;
}
