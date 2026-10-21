import type { PaqadCost, PaqadCostLine, PaqadCostTokens } from './types';

function scaled(value: number, unit: string): string {
  const text = value < 100 ? value.toFixed(1).replace(/\.0$/, '') : String(Math.round(value));
  return `${text}${unit}`;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return scaled(tokens / 1_000_000, 'M');
  if (tokens >= 1_000) return scaled(tokens / 1_000, 'K');
  return String(Math.max(0, Math.round(tokens)));
}

export function formatStopwatch(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

export function fullTokens(tokens: number): string {
  return Math.max(0, Math.round(tokens))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.005) return 'under $0.01';
  return `$${usd.toFixed(2)}`;
}

export function moneyShort(usd: number, priceDate: string): string {
  return `~${formatUsd(usd)} estimate, ${priceDate} prices`;
}

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

const ROLE_ACRONYMS: Readonly<Record<string, string>> = {
  qa: 'QA',
  db: 'DB',
  ux: 'UX',
  ui: 'UI',
  api: 'API',
  devops: 'DevOps',
};

export function roleWords(role: string): string {
  const words = role
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => ROLE_ACRONYMS[word.toLowerCase()] ?? word)
    .join(' ');
  return words ? `${words[0]!.toUpperCase()}${words.slice(1)}` : role;
}

export const CHANGE_SCOPE_SENTENCE =
  "Counted from the change's first row to its seal, this change only.";
export const WHOLE_SESSION_SENTENCE =
  "Whole session: paqad could not split this session's turns, so this is not the change's cost.";

export interface CostLinesOptions {
  lane: string | null;
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
        ? `  ${roleWords(seat.role)}: Run: ${lineText(seat, date)}, mostly the code it read (exact)`
        : `  ${roleWords(seat.role)}: Note: ~${formatTokens(seat.tokens.total)} tokens, the seat's own estimate, already inside the total`,
    );
  }
  if (cost.chief) {
    lines.push(
      cost.chief.exact
        ? `Chief architect: Run: ${lineText(cost.chief, date)}, mostly the code it read (exact)`
        : `Chief architect: Note: ~${formatTokens(cost.chief.tokens.total)} tokens, its own estimate, already inside the total`,
    );
  } else {
    lines.push('Chief architect: no tokens reported yet.');
  }
  return lines;
}

export function costLines(cost: PaqadCost, options: CostLinesOptions): string[] {
  const date = cost.price_table_date;
  const money =
    cost.usd === null
      ? 'no money figure, since no model it used is in the price table'
      : `~${formatUsd(cost.usd)}, ${cost.label}, prices of ${date}`;
  const whole = cost.scope === 'whole-session';
  const lines = [
    `${whole ? 'Cost of the whole session' : 'Cost of this change'}: ${fullTokens(cost.tokens.total)} tokens, ${money}.`,
    `Tokens: ${tokenKinds(cost.tokens)}.`,
    whole ? WHOLE_SESSION_SENTENCE : CHANGE_SCOPE_SENTENCE,
    ...(cost.sealed ? [] : ['Counted so far: the change is not sealed yet.']),
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
