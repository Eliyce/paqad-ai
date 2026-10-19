import { describe, expect, it } from 'vitest';

import { layoutBand } from '../../../../runtime/claude-plugin/mod/band.ts';
import { runPaqadCommand } from '../../../../runtime/claude-plugin/mod/commands.ts';
import {
  costLines,
  costPill,
  formatTokens,
  formatUsd,
  fullTokens,
  moneyShort,
  roleWords,
} from '../../../../runtime/claude-plugin/mod/cost.ts';
import {
  buildBandView,
  parseSnapshot,
  stageLabel,
} from '../../../../runtime/claude-plugin/mod/model.ts';
import {
  DEFAULT_PANE_TAB,
  PANE_ID,
  PANE_TABS,
  buildPaneView,
  isPaneTab,
  tabKey,
} from '../../../../runtime/claude-plugin/mod/pane.ts';
import {
  FAST_ORD_490,
  FAST_ORD_490_COST,
  FULL_ORD_501,
  FULL_ORD_501_COST,
  NOW,
  UNPRICED_COST,
  costRecord,
  fileText,
  snapshot,
} from '../../../../runtime/claude-plugin/mod/test/fixtures.ts';
import type { PaqadCost } from '../../../../runtime/claude-plugin/mod/types/index.d.ts';

// Issue #639, Part 23 (FR-23, INV-10): the cost pill, the Cost tab and `/paqad cost`, all drawn
// from the snapshot's `cost` field. Money always carries the word estimate and the price date; a
// model with no price shows tokens only.

const parse = (raw: Record<string, unknown>) => parseSnapshot(fileText(raw))!;
const costOf = (raw: Record<string, unknown>): PaqadCost => parse(raw).cost!;
const lines = (raw: Record<string, unknown>) =>
  costLines(costOf(raw), { lane: parse(raw).lane, stageLabel });
const command = (args: string, raw: Record<string, unknown> | null) =>
  runPaqadCommand({
    args,
    standDown: null,
    snapshot: raw ? parse(raw) : null,
    receipt: null,
    now: NOW,
  }).text;

/** Every money figure in `text` sits on a line that says estimate and the price date. */
function expectDatedMoney(text: string): void {
  const money = text.split('\n').filter((line) => line.includes('$'));
  expect(money.length).toBeGreaterThan(0);
  for (const line of money) {
    expect(line).toContain('estimate');
    expect(line).toContain('2026-10-19');
  }
}

describe('formatting', () => {
  it('says token counts short and in full', () => {
    expect(formatTokens(812)).toBe('812');
    expect(formatTokens(45_300)).toBe('45.3k');
    expect(formatTokens(1_300_000)).toBe('1.3M');
    expect(fullTokens(1_234_567)).toBe('1,234,567');
  });

  it('says dollars to the cent and a sliver as under a cent', () => {
    expect(formatUsd(24)).toBe('$24.00');
    expect(formatUsd(0.001)).toBe('under $0.01');
    expect(formatUsd(0)).toBe('$0.00');
    expect(moneyShort(0.42, '2026-10-19')).toBe('~$0.42 estimate, 2026-10-19 prices');
  });

  it('puts role ids in words', () => {
    expect(roleWords('security-auditor')).toBe('Security auditor');
    expect(roleWords('')).toBe('');
    expect(stageLabel('development')).toBe('Build');
    expect(stageLabel('orchestrator')).toBe('Between stages');
    expect(stageLabel('custom')).toBe('custom');
  });
});

describe('the cost pill (AC-50)', () => {
  it('reads "not yet" with no cost record', () => {
    expect(costPill(null)).toBe('cost: not yet');
    expect(buildBandView(parse(FULL_ORD_501), NOW).cost).toBe('cost: not yet');
  });

  it('shows tokens and money labelled estimate with the price date', () => {
    const pill = costPill(costOf(FULL_ORD_501_COST));
    expect(pill).toBe('1.3M tokens, ~$4.60 estimate, 2026-10-19 prices');
    expectDatedMoney(pill);
  });

  it('says when part of the tokens has no price', () => {
    const partial = costOf(
      snapshot({ ...FULL_ORD_501, cost: costRecord({ unpriced_models: ['x'] }) }),
    );
    expect(costPill(partial)).toContain('part unpriced');
  });

  it('shows tokens only for a model the table does not list', () => {
    expect(costPill(costOf(UNPRICED_COST))).toBe('10.0k tokens');
    expect(costPill(costOf(UNPRICED_COST))).not.toContain('$');
  });

  it('is a pill in the band that opens the Cost tab', () => {
    const rows = layoutBand(buildBandView(parse(FULL_ORD_501_COST), NOW), {
      columns: 120,
      maxRows: 12,
    });
    const pill = rows.flat().find((segment) => segment.opens === 'cost');
    expect(pill?.text).toBe('1.3M tokens, ~$4.60 estimate, 2026-10-19 prices');
  });
});

describe('reading the cost from the snapshot', () => {
  it('drops money from a record with no price date, keeping the tokens (INV-10)', () => {
    const undated = costRecord({ price_table_date: null });
    const cost = costOf(snapshot({ ...FULL_ORD_501, cost: undated }));
    expect(cost.usd).toBeNull();
    expect(cost.by_stage.every((line) => line.usd === null)).toBe(true);
    expect(cost.chief?.usd).toBeNull();
    expect(cost.tokens.total).toBe(1_300_000);
    expect(costPill(cost)).toBe('1.3M tokens');
  });

  it('reads a missing or broken cost as null and skips broken lines', () => {
    expect(parse(FULL_ORD_501).cost).toBeNull();
    expect(parse(snapshot({ cost: 'nope' })).cost).toBeNull();
    const odd = costOf(
      snapshot({
        cost: {
          price_table_date: '2026-10-19',
          tokens: { total: -5 },
          by_stage: [{ tokens: {} }, 'x'],
          by_expert: [{ usd: 1 }],
          unpriced_models: [1, 'm'],
          not_counted: [null, 'Batch discounts'],
        },
      }),
    );
    expect(odd).toMatchObject({
      label: 'estimate at API prices',
      basis: 'API-equivalent estimate',
      sealed: false,
      usd: null,
      by_stage: [],
      by_expert: [],
      chief: null,
      unpriced_models: ['m'],
      not_counted: ['Batch discounts'],
    });
    expect(odd.tokens.total).toBe(0);
  });
});

describe('the Cost tab and /paqad cost (AC-55)', () => {
  it('shows the total, by stage, by expert and the chief, the basis and what is not counted', () => {
    const text = lines(FULL_ORD_501_COST);
    expect(text[0]).toBe(
      'Cost of this change: 1,300,000 tokens, ~$4.60, estimate at API prices (API-equivalent on a Pro or Max plan), prices of 2026-10-19.',
    );
    expect(text).toContain(
      'Tokens: 2,000 input, 98,000 output, 1,100,000 cache read, 100,000 cache write.',
    );
    expect(text).toContain('Counted from the first record to the seal.');
    expect(text).toContain('By stage:');
    expect(text).toContain('  Build: 640.0k tokens, ~$2.30 estimate, 2026-10-19 prices');
    expect(text).toContain('  Between stages: 70.0k tokens, ~$0.26 estimate, 2026-10-19 prices');
    expect(text).toContain('By expert:');
    expect(text).toContain('  Security auditor: 40.0k tokens, ~$0.14 estimate, 2026-10-19 prices');
    expect(text).toContain(
      "  QA engineer: about 1.8k tokens, the seat's own estimate, already inside the total",
    );
    expect(text).toContain('Chief architect: 25.0k tokens, ~$0.09 estimate, 2026-10-19 prices');
    expect(text.find((line) => line.startsWith('Basis: '))).toContain(
      'API-equivalent estimate. Tokens come from the session',
    );
    expect(text.find((line) => line.startsWith('Basis: '))).toContain('On a Pro or Max plan');
    expect(text.at(-1)).toBe(
      'Not counted: The fast mode premium; The 1.1 times multiplier for US-only inference; Batch discounts.',
    );
    expectDatedMoney(text.join('\n'));
  });

  it('/paqad cost prints the same text the Cost tab draws', () => {
    const tab = buildPaneView(parse(FULL_ORD_501_COST), 'cost').lines.join('\n');
    expect(command('cost', FULL_ORD_501_COST)).toBe(tab);
    expectDatedMoney(tab);
  });

  it('says not yet with no record, and no cost with no change', () => {
    expect(command('cost', FULL_ORD_501)).toBe(
      'Cost: not yet. paqad counts it from the transcripts at the end of each turn.',
    );
    expect(command('cost', snapshot())).toBe(
      'No change is in progress, so there is no cost to show.',
    );
    expect(command('cost', null)).toContain('Not yet. paqad has no record for this session.');
    expect(buildPaneView(null, 'cost').lines).toEqual([
      'Not yet. paqad has no record for this session.',
    ]);
    expect(buildPaneView(parse(snapshot()), 'cost').lines).toEqual([
      'No change is in progress, so there is no cost to show.',
    ]);
    expect(buildPaneView(parse(FULL_ORD_501), 'cost').lines).toEqual([
      'Cost: not yet. paqad counts it from the transcripts at the end of each turn.',
    ]);
  });

  it('names an unpriced model and shows its tokens with no money (AC-50)', () => {
    const text = lines(UNPRICED_COST);
    expect(text[0]).toBe(
      'Cost of this change: 10,000 tokens, no money figure, since no model it used is in the price table.',
    );
    expect(text).toContain(
      'No price for claude-future-9: its tokens are in the total, its money is not.',
    );
    expect(text.filter((line) => line.includes('$'))).toEqual([]);
  });

  it('a chief with only an estimate, and no chief at all', () => {
    const estimate = costRecord({
      chief: { tokens: { total: 900 }, usd: null, exact: false },
      by_expert: [],
    });
    expect(lines(snapshot({ ...FULL_ORD_501, cost: estimate }))).toContain(
      'Chief architect: about 900 tokens, its own estimate, already inside the total',
    );
    const noChief = costRecord({ chief: null });
    expect(lines(snapshot({ ...FULL_ORD_501, cost: noChief }))).toContain(
      'Chief architect: no tokens reported yet.',
    );
    const none = costRecord({ chief: null, by_expert: [], by_stage: [] });
    const text = lines(snapshot({ ...FULL_ORD_501, cost: none }));
    expect(text).toContain('By expert: none. No High Table seat has reported tokens.');
    expect(text).toContain('  none yet');
  });
});

describe('the fast lane (AC-53)', () => {
  it('shows no expert tokens and says the fast lane seats no High Table', () => {
    const text = lines(FAST_ORD_490_COST);
    expect(text).toContain('By expert: none. The fast lane seats no High Table.');
    expect(text.join('\n')).not.toMatch(/Chief architect|Security auditor/);
    expect(text).toContain('Counted so far: the change is not sealed yet.');
    expect(costOf(FAST_ORD_490_COST).by_expert).toEqual([]);
    expect(parse(FAST_ORD_490).cost).toBeNull();
  });
});

describe('the pane (Parts 23 and 14)', () => {
  it('has one pane id, the High Table tab then the Cost tab', () => {
    expect(PANE_ID).toBe('paqad');
    expect(PANE_TABS.map((tab) => tab.id)).toEqual(['table', 'cost']);
    expect(DEFAULT_PANE_TAB).toBe('cost');
    expect(isPaneTab('cost')).toBe(true);
    expect(isPaneTab('table')).toBe(true);
    expect(isPaneTab('nope')).toBe(false);
    const view = buildPaneView(parse(FULL_ORD_501_COST), 'cost');
    expect(view.tabs).toEqual([
      { id: 'table', key: tabKey('table'), label: 'High Table', selected: false },
      { id: 'cost', key: tabKey('cost'), label: 'Cost', selected: true },
    ]);
    expect(view.table).toBeNull();
  });

  it('opens on its own pick for a tab it does not have: the High Table when there is one, else Cost', () => {
    const view = buildPaneView(parse(FULL_ORD_501_COST), 'nope' as never);
    expect(view.tabs[0]!.selected).toBe(true);
    expect(view.table).not.toBeNull();
    const fast = buildPaneView(parse(FAST_ORD_490_COST), null);
    expect(fast.tabs[1]!.selected).toBe(true);
    expect(fast.lines[0]).toContain('Cost of this change');
  });
});
