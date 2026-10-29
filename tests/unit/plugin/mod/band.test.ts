import { describe, expect, it } from 'vitest';

import {
  IDLE_HEADLINE,
  changeChip,
  laneMode,
  layoutBand,
  rowText,
  spinnerWord,
  tokensChip,
  truncateRow,
  type BandRow,
} from '../../../../runtime/claude-plugin/mod/band.ts';
import { runPaqadCommand } from '../../../../runtime/claude-plugin/mod/commands.ts';
import { STAGE_MARK } from '../../../../runtime/claude-plugin/mod/instruments.ts';
import { buildDesktopBand } from '../../../../runtime/claude-plugin/mod/desktop-view.ts';
import { IDLE_LIVE } from '../../../../runtime/claude-plugin/mod/live.ts';
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
  NOW,
  PAUSED,
  STATE_FIXTURES,
  fileText,
  snapshot,
  stages,
} from '../../../../runtime/claude-plugin/mod/test/fixtures.ts';

import { ticketRef } from '../../../shared/ticket-ref.js';

import { bandLines, bandOf, layoutLines } from './band-text.ts';

describe('the band shell', () => {
  it('draws one card: brand, change chip, headline, then the chips, Proof, minimise and close', () => {
    const band = bandOf(FULL_ORD_501);
    expect(band.kind).toBe('card');
    expect(bandLines(FULL_ORD_501)[0]).toBe(
      'paqad ORD-501  Safe to merge. 1 flag open. | Safe to merge  1 flag  full lane  Proof  – Minimise  × Close',
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
    expect(at({ issue: '42', id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' })).toBe(ticketRef(42));
    expect(at({ issue: 'ORD-9', id: 'x' })).toBe('ORD-9');
    expect(at({ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' })).toBe('9G5FAV');
    expect(at({})).toBeNull();
    expect(changeChip(null)).toBeNull();
  });

  it('idles with only the header before the first read, and draws nothing until a change opens', () => {
    expect(bandLines(null)).toEqual(['paqad  Getting ready | – Minimise  × Close']);
    expect(
      bandOf({ ...FULL_ORD_501, scope: { qualified: false, reason: 'other-branch' } }).kind,
    ).toBe('none');
    expect(bandOf({ ...FULL_ORD_501, active: false }).kind).toBe('none');
    expect(bandOf(snapshot()).kind).toBe('none');
    expect(bandOf({ ...snapshot(), route: 'no-workflow' }).kind).toBe('none');
    expect(bandLines(PAUSED)).toEqual(['paqad · question · counting']);
  });

  it('labels each control in words and gives it a hotkey', () => {
    for (const action of ['minimise', 'restore', 'close'] as const) {
      const control = controlSegment(action);
      expect(control.text).toMatch(/^[–+×] [A-Z][a-z]+$/);
      expect(control.hotkey).toMatch(/^[a-z]$/);
      expect(control.action).toBe(action);
    }
  });

  it('registers only the feature-development body, and the shell holds no body code', () => {
    expect(Object.keys(BAND_BODIES)).toEqual(['feature-development']);
  });
});

describe('the instruments lay out by width', () => {
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
    expect(layoutLines(line)).toEqual([
      'paqad ORD-501 Safe to merge ○✓✓✓✓✓✓○ Docs · done High Table spec approved 3 of your commits 1 flag + Restore × Close',
    ]);
    expect(layoutLines(bandOf(null, 120, 2))).toEqual(['paqad · Getting ready + Restore × Close']);
    expect(layoutLines(bandOf(FULL_ORD_501, 20, 5))[0]).toBe(
      'paqad ORD-501 Safe to merge 1 flag + Restore × Close',
    );
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
    expect(cardRows(body.blocks, 'column', false)).toBe(2 + 1 + 1 + 4 + 3);
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

describe('partial and broken data', () => {
  it('keeps each instrument with a neutral mark when a qualified change has no gates or split', () => {
    const raw = {
      ...FULL_ORD_501_COST,
      gates: [],
      claims: [],
      cost: { ...(FULL_ORD_501_COST.cost as object), scope: 'whole-session' },
    };
    const lines = bandLines(raw);
    expect(lines.at(-1)).toBe(
      '1.3M tokens · whole session | Not judged yet · 12 rules loaded · 0 rule findings',
    );
    expect(lines.some((line) => line.startsWith('SHIP'))).toBe(true);
    expect(lines.some((line) => line.startsWith('STAGE'))).toBe(true);
    const unloaded = bandLines({ ...raw, rules: { recorded: false } });
    expect(unloaded.at(-1)).toContain('Not judged yet · rules not loaded yet');
  });

  it('says HUD data unavailable on the idle header when the snapshot could not be read', () => {
    const band = layoutBand(
      null,
      { columns: 120, maxRows: 12 },
      {
        now: 0,
        surface: 'terminal',
        unavailable: true,
      },
    );
    expect(layoutLines(band)).toEqual([
      'paqad  Getting ready  HUD data unavailable | – Minimise  × Close',
    ]);
  });
});

describe('the STAGE instrument', () => {
  it('draws eight labelled cells with marks and the running stage clock', () => {
    const lines = bandLines(FAST_ORD_490);
    expect(lines.slice(1, 4)).toEqual([
      'STAGE  Build · 2:00',
      '○ ✓ – ▸ – ○ – ○',
      'Intake Plan Spec Build Review Checks Docs Deliver',
    ]);
  });

  it('AC-13, AC-22: a done stage is a green check one column wide, with no animation', () => {
    expect(STAGE_MARK.done).toEqual({ mark: '✓', tone: 'good' });
    expect([...STAGE_MARK.done.mark]).toHaveLength(1);
    const lines = bandLines(FAST_ORD_490);
    expect(lines[2]!.split(' ').map((mark) => mark.length)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
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
    expect(odd.slice(1, 3)).toEqual(['STAGE  Review · running', '○ ✗ – ◐ ▸ ○ – ○']);
  });
});

describe('AC-30: the terminal band fits its box', () => {
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

describe('AC-19, AC-32: one headline on every surface', () => {
  const finished = {
    ...FULL_ORD_501,
    scope: { qualified: true, reason: 'finished' },
    rung: 'done',
    flags: [],
    headline: {
      text: 'Done',
      tone: 'good',
      row: 16,
      word: 'Done',
      rung: 'done',
      note: 'not committed',
      gap: 'paqad could not record the lane for this change',
    },
  };

  it('the desktop band, the terminal shell and /paqad status show the same headline and tone', () => {
    const snap = parseSnapshot(fileText(finished))!;
    const desktop = buildDesktopBand({
      snapshot: snap,
      unbound: false,
      unavailable: false,
      now: NOW,
      turnStartedAt: null,
      visibility: { minimised: false, closed: false, hidden: false },
      menuOpen: false,
      columns: 93,
      maxRows: 12,
    });
    expect(desktop).toMatchObject({
      kind: 'feature',
      mode: 'card',
      headline: { text: 'Done', signal: 'pass', tone: 'good', note: 'not committed' },
    });
    const terminal = bandOf(finished);
    if (terminal.kind !== 'card') throw new Error('expected a card');
    expect(terminal.tone).toBe('good');
    expect(rowText(terminal.header.left)).toBe(
      'paqad ORD-501  Done  not committed  paqad could not record the lane for this change',
    );
    expect(terminal.header.left.find((s) => s.text === '  Done')).toMatchObject({ tone: 'good' });
    expect(terminal.header.left.find((s) => s.text === '  not committed')).toMatchObject({
      dim: true,
    });
    expect(rowText(terminal.header.right)).not.toContain('Safe to merge');
    const status = runPaqadCommand({
      args: 'status',
      standDown: null,
      snapshot: snap,
      receipt: null,
      now: NOW,
    }).text;
    expect(status.split('\n').slice(0, 3)).toEqual([
      'Done.',
      'Note: not committed.',
      'paqad could not record the lane for this change.',
    ]);
    expect(`${rowText(terminal.header.left)} ${status}`).not.toContain('Fix it');
  });

  it('a finished change keeps its band and says Done instead of the idle view', () => {
    expect(bandLines(finished)[0]).toContain('Done');
    expect(bandLines(finished)[0]).not.toContain(IDLE_HEADLINE);
  });
});

describe('the terminal headline stays on one line', () => {
  it('cuts a long headline with an ellipsis so the header fits the band width', () => {
    const LONG =
      'The chief architect is ruling on every disagreement the High Table raised about this change';
    const raw = { ...FULL_ORD_501, headline: { text: LONG, tone: 'working', row: 15 } };
    for (const columns of [80, 120]) {
      const layout = bandOf(raw, columns);
      expect(layout.kind).toBe('card');
      if (layout.kind !== 'card') continue;
      const headline = layout.header.left.find((segment) => segment.text.includes('The chief'))!;
      expect(headline.text.endsWith('…')).toBe(true);
      const width = (segments: typeof layout.header.left) =>
        segments.reduce((sum, segment) => sum + [...segment.text].length, 0);
      const noteless = layout.header.left.filter((segment) => !segment.dim || segment === headline);
      expect(width(noteless) + width(layout.header.right)).toBeLessThanOrEqual(columns - 4);
    }
  });
});

describe('live subagents on the terminal', () => {
  it('titles the newest subagent and draws its two lines under the header', () => {
    const layout = layoutBand(
      parseSnapshot(fileText(FULL_ORD_501)),
      { columns: 120, maxRows: 12 },
      {
        now: NOW,
        surface: 'terminal',
        live: {
          ...IDLE_LIVE,
          agents: {
            running: [{ id: 'a', description: 'Run the checks', status: 'running' }],
            lines: ['Bash: pnpm test', 'Grep: ciWatch'],
            finished: 2,
          },
        },
      },
    );
    expect(layout.kind).toBe('card');
    if (layout.kind !== 'card') return;
    expect(rowText(layout.header.left)).toContain('Subagent: Run the checks  2 finished');
    expect(layout.activity.map(rowText)).toEqual(['  Bash: pnpm test', '  Grep: ciWatch']);
  });
});
