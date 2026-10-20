import { describe, expect, it } from 'vitest';

import {
  changeChip,
  laneMode,
  rowText,
  spinnerWord,
  tokensChip,
  truncateRow,
  type BandRow,
} from '../../../../runtime/claude-plugin/mod/band.ts';
import { parseSnapshot } from '../../../../runtime/claude-plugin/mod/model.ts';
import {
  BAND_BODIES,
  cardRows,
  controlSegment,
  headerRow,
  layoutShell,
  type BandBody,
  type ShellHeader,
} from '../../../../runtime/claude-plugin/mod/shell.ts';
import {
  EXPERTS_OFF,
  FAST_ORD_490,
  FULL_ORD_501,
  FULL_ORD_501_COST,
  GRADUATED_ORD_482,
  PAUSED,
  STATE_FIXTURES,
  fileText,
  snapshot,
  stages,
} from '../../../../runtime/claude-plugin/mod/test/fixtures.ts';

import { bandLines, bandOf, layoutLines } from './band-text.ts';

describe('the band shell (FR-30, FR-31)', () => {
  it('draws one card: brand, change chip, headline, then the chips, Proof, minimise and close', () => {
    const band = bandOf(FULL_ORD_501);
    expect(band.kind).toBe('card');
    expect(bandLines(FULL_ORD_501)[0]).toBe(
      'paqad ORD-501  2 of 2 required gates pass | Safe to merge  1 flag  full lane  Proof  – Minimise  × Close',
    );
    if (band.kind !== 'card') return;
    expect(band.tone).toBe('warn');
    expect(band.header.left[0]).toMatchObject({ text: 'paqad', opens: 'trust' });
    expect(band.header.right.find((s) => s.text === 'Proof')).toMatchObject({ opens: 'trust' });
    expect(band.header.right.find((s) => s.text === '1 flag')).toMatchObject({
      tone: 'warn',
      opens: 'trust',
    });
  });

  it('shows the tokens chip and opens Cost from it, saying whole session when not split', () => {
    const band = bandOf(FULL_ORD_501_COST);
    if (band.kind !== 'card') throw new Error('expected a card');
    expect(band.header.right.find((s) => s.opens === 'cost')?.text).toBe('1.3M tokens');
    const whole = parseSnapshot(
      fileText({
        ...FULL_ORD_501_COST,
        cost: { ...(FULL_ORD_501_COST.cost as object), scope: 'whole-session' },
      }),
    );
    expect(tokensChip(whole)).toBe('1.3M tokens · whole session');
    expect(tokensChip(null)).toBeNull();
  });

  it('names a change by its issue number, else its ticket, else the short ULID', () => {
    const at = (change: Record<string, unknown>) =>
      changeChip(parseSnapshot(fileText({ ...FAST_ORD_490, change })));
    expect(at({ issue: '702', id: '01M5DHQYW9J0Y7ZGF6QN0E34GE' })).toBe('#702');
    expect(at({ issue: 'ORD-9', id: 'x' })).toBe('ORD-9');
    expect(at({ id: '01M5DHQYW9J0Y7ZGF6QN0E34GE' })).toBe('0E34GE');
    expect(at({})).toBeNull();
    expect(changeChip(null)).toBeNull();
  });

  it('idles with only the header, minimise and close when no change qualifies (FR-4, FR-39)', () => {
    for (const raw of [null, PAUSED, snapshot()]) {
      expect(bandLines(raw)).toEqual([
        'paqad  feature development · no change in progress | – Minimise  × Close',
      ]);
    }
  });

  it('labels each control in words and gives it a hotkey (FR-52, AC-47)', () => {
    for (const action of ['minimise', 'restore', 'close'] as const) {
      const control = controlSegment(action);
      expect(control.text).toMatch(/^[–+×] [A-Z][a-z]+$/);
      expect(control.hotkey).toMatch(/^[a-z]$/);
      expect(control.action).toBe(action);
    }
  });

  it('registers only the feature-development body, and the shell holds no body code (INV-8)', () => {
    expect(Object.keys(BAND_BODIES)).toEqual(['feature-development']);
  });
});

describe('the instruments lay out by width (FR-38, AC-30)', () => {
  it('sits in one row at 110 columns and more, and stacks below', () => {
    for (const columns of [120, 110]) {
      const band = bandOf(FULL_ORD_501, columns, 12);
      expect(band.kind === 'card' && band.direction).toBe('row');
      expect(band.kind === 'card' && band.footer).not.toBeNull();
    }
    for (const columns of [109, 80]) {
      const band = bandOf(FULL_ORD_501, columns, 14);
      expect(band.kind === 'card' && band.direction).toBe('column');
      expect(band.kind === 'card' && band.footer).toBeNull();
    }
  });

  it('drops the footer first, then falls back to one line when rows are short', () => {
    const roomy = bandOf(FULL_ORD_501, 120, 7);
    expect(roomy.kind === 'card' && roomy.footer).not.toBeNull();
    const tight = bandOf(FULL_ORD_501, 120, 6);
    expect(tight.kind === 'card' && tight.footer).toBeNull();
    const line = bandOf(FULL_ORD_501, 120, 5);
    expect(line.kind).toBe('line');
    expect(layoutLines(line)).toEqual(['paqad · Safe to merge · 1 flag open.']);
    expect(layoutLines(bandOf(null, 120, 2))).toEqual([
      'paqad · feature development · no change in progress',
    ]);
    expect(layoutLines(bandOf(FULL_ORD_501, 20, 5))[0]).toBe('paqad · Safe to mer…');
  });

  it('counts the rows a card needs', () => {
    const body: BandBody = {
      blocks: [
        { key: 'a', title: [{ text: 'A' }], cells: [], svg: null, note: null },
        {
          key: 'b',
          title: [{ text: 'B' }],
          cells: [{ key: 'c', top: { text: '●' }, bottom: { text: 'C' } }],
          svg: null,
          note: [{ text: 'note' }],
        },
        {
          key: 'd',
          title: [{ text: 'D' }],
          cells: [],
          svg: { source: '<svg/>', alt: 'd', width: 1, height: 1 },
          note: null,
        },
      ],
      footer: null,
    };
    expect(cardRows(body.blocks, 'row', true)).toBe(2 + 1 + 4 + 1);
    expect(cardRows(body.blocks, 'column', false)).toBe(2 + 1 + 1 + 4 + 4);
    expect(cardRows([], 'row', false)).toBe(3);
    const header: ShellHeader = {
      tone: 'neutral',
      chip: null,
      headline: 'h',
      verdict: null,
      flags: 0,
      lane: null,
      tokens: null,
    };
    expect(layoutShell(header, body, { columns: 50, maxRows: 0.5 }, [{ text: 'x' }])).toEqual({
      kind: 'line',
      row: [{ text: 'x' }],
    });
    expect(rowText(headerRow(header, true).right)).toBe('– Minimise  × Close');
  });
});

describe('the STAGE instrument (FR-33)', () => {
  it('draws eight labelled cells with marks and the running stage clock', () => {
    const lines = bandLines(FAST_ORD_490);
    expect(lines.slice(1, 4)).toEqual([
      'STAGE  Build · 2:00',
      '○ ● – ▸ ○ ○ ○ ○',
      'Intake Plan Spec Build Review Checks Docs Deliver',
    ]);
  });

  it('says done, failed, marked and paused for you in words beside the marks', () => {
    const at = (raw: Record<string, unknown>) => bandLines(raw)[1];
    expect(at(FULL_ORD_501)).toBe('STAGE  Docs · done');
    expect(at(GRADUATED_ORD_482)).toBe('STAGE  paused for you');
    expect(
      at({
        ...GRADUATED_ORD_482,
        stages: stages({ planning: 'complete', specification: 'running' }),
      }),
    ).toBe('STAGE  Spec · paused for you');
    expect(at({ ...FULL_ORD_501, stages: stages({}) })).toBe('STAGE  not started');
    const odd = bandLines({
      ...FAST_ORD_490,
      stages: stages(
        { planning: 'failed', development: 'inconclusive', review: 'running' },
        { review: 'never' },
      ),
    });
    expect(odd.slice(1, 3)).toEqual(['STAGE  Review · running', '○ ✗ – ◐ ▸ ○ ○ ○']);
  });
});

describe('the terminal band fits its box (AC-43)', () => {
  it('never draws an em dash', () => {
    for (const raw of [...Object.values(STATE_FIXTURES), EXPERTS_OFF, null]) {
      expect(bandLines(raw).join('\n')).not.toContain('—');
    }
  });

  it('cuts a row with an ellipsis and never wraps', () => {
    const row: BandRow = [{ text: 'abcdef', tone: 'good' }, { text: 'ghij' }];
    expect(truncateRow(row, 20)).toBe(row);
    expect(truncateRow(row, 5)).toEqual([{ text: 'abcd', tone: 'good' }, { text: '…' }]);
    expect(truncateRow(row, 7)).toEqual([{ text: 'abcdef', tone: 'good' }, { text: '…' }]);
    expect(rowText(truncateRow(row, 0))).toBe('…');
  });
});

describe('the spinner word and the lane mode', () => {
  const at = (raw: Record<string, unknown>) => parseSnapshot(fileText(raw));

  it('says the running stage in words', () => {
    expect(spinnerWord(at(FAST_ORD_490))).toBe('Building');
    for (const [stage, word] of [
      ['ticket_intake', 'Reading the ticket'],
      ['planning', 'Planning'],
      ['specification', 'Writing the spec'],
      ['review', 'Reviewing'],
      ['checks', 'Running checks'],
      ['documentation_sync', 'Syncing the docs'],
      ['delivery', 'Delivering'],
    ] as const) {
      expect(spinnerWord(at({ ...FAST_ORD_490, stages: stages({ [stage]: 'running' }) }))).toBe(
        word,
      );
    }
  });

  it('keeps the engine word when no stage runs or no change is in progress', () => {
    expect(spinnerWord(at(FULL_ORD_501))).toBeNull();
    expect(spinnerWord(at(PAUSED))).toBeNull();
    expect(spinnerWord(null)).toBeNull();
  });

  it('names the lane only while a change is in progress', () => {
    expect(laneMode(at(FAST_ORD_490))).toBe('paqad fast lane');
    expect(laneMode(at(GRADUATED_ORD_482))).toBe('paqad graduated lane');
    expect(laneMode(at(PAUSED))).toBeNull();
    expect(laneMode(at({ ...FAST_ORD_490, lane: null }))).toBeNull();
  });
});
