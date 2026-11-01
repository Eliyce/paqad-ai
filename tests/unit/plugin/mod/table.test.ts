import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { featureFilePath } from '@/feature-evidence/paths.js';
import { buildHighTableView } from '@/hud/high-table-view.js';

import { roleInitials } from '../../../../runtime/claude-plugin/mod/instruments.ts';
import { roleWords } from '../../../../runtime/claude-plugin/mod/cost.ts';
import { VERDICT_WORDS, parseSnapshot } from '../../../../runtime/claude-plugin/mod/model.ts';
import { PANE_TABS, buildPaneView } from '../../../../runtime/claude-plugin/mod/pane.ts';
import {
  SEAT_COLOR,
  SEAT_MARK,
  SKIPPED_TEXT,
  cardKey,
  decisionDate,
  isExpertsCall,
  isOpenConflict,
  noTableText,
  noteTokens,
  runTokens,
  seatTokens,
  showsTable,
  tableCardLines,
  tableFlags,
  tableInstrument,
  tablePaneView,
  tableSvg,
  trackRecordWords,
  type TableLine,
} from '../../../../runtime/claude-plugin/mod/table.ts';
import {
  AUTO_ANSWER_DECISION,
  EXPERTS_OFF,
  FAST_ORD_490,
  FULL_ORD_501,
  GRADUATED_ORD_482,
  LATE_TABLE,
  NOW,
  ORD_482_SEQUENCE,
  ORD_501_CREDITS,
  ORD_501_SEATS,
  ORD_501_SEQUENCE,
  PAUSED,
  SETTLED_DECISION,
  SKIPPED_TABLE,
  STATE_FIXTURES,
  fileText,
  ord482At,
  ord501At,
  snapshot,
} from '../../../../runtime/claude-plugin/mod/test/fixtures.ts';
import type {
  PaqadHighTable,
  PaqadHudSnapshot,
} from '../../../../runtime/claude-plugin/mod/types/index.d.ts';

import { bandOf, blockLines, blockOf, layoutLines } from './band-text.ts';

type Raw = Record<string, unknown>;
const parse = (raw: Raw): PaqadHudSnapshot => parseSnapshot(fileText(raw))!;
type WithTable = PaqadHudSnapshot & { table: PaqadHighTable };
const withTable = (raw: Raw): WithTable => {
  const snap = parse(raw);
  if (!showsTable(snap)) throw new Error('fixture has no table');
  return snap;
};
const tableRowOf = (raw: Raw): string | undefined => {
  const block = blockOf(bandOf(raw), 'paqad-instrument-table');
  return block ? blockLines(block).join(' / ') : undefined;
};
const text = (line: TableLine) => line.map((segment) => segment.text).join('');
const cardText = (raw: Raw, now = NOW) => tableCardLines(withTable(raw).table, now).map(text);
const paneText = (raw: Raw, seat: string | null = null) => {
  const view = tablePaneView(withTable(raw), seat, NOW);
  return [...view.ring, ...view.seats, ...view.detail, ...view.rulings].map(text);
};

describe('the snapshot table, read defensively (FR-24)', () => {
  it('keeps every field of a seat, the chief, the rulings, the questions and the credits', () => {
    const table = parse(FULL_ORD_501).table!;
    expect(table.seats.map((seat) => seat.role)).toEqual(ORD_501_SEATS.map((plan) => plan.role));
    expect(table.seats[3]).toEqual({
      role: 'qa-engineer',
      reason: 'standing expert (always at the table)',
      origin: 'standing',
      state: 'done',
      seated_at: '2026-10-18T08:10:00.000Z',
      started_at: '2026-10-18T08:10:06.000Z',
      done_at: '2026-10-18T08:12:20.000Z',
      budget_tokens: 4000,
      clamped: false,
      tokens_estimate: 900,
      tokens: { input: 5, output: 430, cache_read: 16000, cache_write: 7600, total: 24035 },
      tokens_exact: true,
      findings: 2,
      late: false,
      track_record: null,
    });
    expect(table.seats[0]!.track_record).toEqual({
      changes: 6,
      changed_spec: 4,
      empty: 1,
      avg_tokens: 2300,
    });
    expect(table.chief).toMatchObject({ role: 'chief-architect', verdict: 'proceed' });
    expect(table.rulings?.settled).toEqual([
      { target: 'Date range limit', chosen: '90 days at most', source: SETTLED_DECISION },
    ]);
    expect(table.questions?.auto_answered[0]?.source).toBe(AUTO_ANSWER_DECISION);
    expect(table.credits).toEqual(ORD_501_CREDITS);
  });

  it('reads a missing, broken or foreign table as null or empty, never a guess', () => {
    expect(parse(FAST_ORD_490).table).toBeNull();
    expect(parse(snapshot({ table: 'nope' })).table).toBeNull();
    const odd = parse(
      snapshot({
        table: {
          seats: [
            { role: 'qa-engineer', state: 'thinking', tokens_exact: true, tokens: null },
            { state: 'done' },
            'nope',
          ],
          chief: { verdict: 'proceed' },
          rulings: { declined: [{}, 'x'], conflicts: 'x' },
          gaps: [{ area: 'Retention' }],
          questions: { auto_answered: [{ question: 'Format?' }] },
          credits: [{ line: 'FR-1', roles: ['qa-engineer', 3] }],
        },
      }),
    ).table!;
    expect(odd.seats).toHaveLength(1);
    expect(odd.seats[0]).toMatchObject({ state: 'seated', tokens_exact: false, tokens: null });
    expect(odd.chief).toBeNull();
    expect(odd.rulings).toEqual({
      accepted: [],
      declined: [{ id: '', reason: '' }],
      conflicts: [],
      merged: [],
      renames: [],
      settled: [],
    });
    expect(odd.gaps).toEqual([{ area: 'Retention', why_it_matters: '', question: null }]);
    expect(odd.questions).toEqual({
      asked: 0,
      auto_answered: [{ question: 'Format?', source: '' }],
    });
    expect(odd.credits).toEqual([{ line: 'FR-1', roles: ['qa-engineer'] }]);
    expect(odd.skipped).toBe(false);
  });
});

describe('the fixture table matches the one paqad writes', () => {
  const roots: string[] = [];
  afterEach(() => {
    while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
  });

  it('carries the same keys on the table, a seat, the chief and the rulings', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-mod-table-'));
    roots.push(root);
    const dir = 'ORD-501-table';
    const write = (file: 'experts' | 'clarification', body: unknown) => {
      const path = join(root, featureFilePath(dir, file));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(body));
    };
    write('experts', {
      roster: [{ role: 'qa-engineer', reason: 'tests', origin: 'standing', budget_tokens: 4000 }],
      findings: [{ id: 'EX-qa-engineer-1', role: 'qa-engineer', target: 'export' }],
      synthesis: {
        verdict: 'proceed',
        accepted: ['EX-qa-engineer-1'],
        declined: [],
        conflicts: [],
        renames: [],
        auto_resolved: [{ target: 'Date range', chosen: '90 days', source: SETTLED_DECISION }],
        gaps: [],
      },
    });
    write('clarification', { questions: { asked: [], auto_answered: [] } });
    const real = buildHighTableView(
      root,
      dir,
      { pipeline: { produced: true }, trace: { 'FR-1': 'EX-qa-engineer-1' } },
      'full',
    )!;
    const fixture = (FULL_ORD_501 as { table: Record<string, Record<string, unknown>> }).table;
    const keys = (value: unknown) => Object.keys(value as object).sort();
    expect(keys(fixture)).toEqual(keys(real));
    expect(keys((fixture.seats as unknown as unknown[])[0])).toEqual(keys(real.seats[0]));
    expect(keys(fixture.chief)).toEqual(keys(real.chief));
    expect(keys(fixture.rulings)).toEqual(keys(real.rulings));
    expect(parse(snapshot({ table: real })).table?.seats[0]?.role).toBe('qa-engineer');
  });
});

describe('the HIGH TABLE instrument (FR-34, AC-31, AC-56, AC-57)', () => {
  it('AC-56: shows on ORD-482 and ORD-501, never on the fast lane, paused or with the experts off', () => {
    expect(tableRowOf(GRADUATED_ORD_482)).toBe(
      'HIGH TABLE  spec approved / ● ● ● ● │ ◆ / PO AA UF QA   CA',
    );
    expect(tableRowOf(FULL_ORD_501)).toBe(
      'HIGH TABLE  spec approved / ● ● ● ● ● ● ● │ ◆ / PO AA UF QA SA DE PA   CA',
    );
    expect(tableRowOf(FAST_ORD_490)).toBeUndefined();
    expect(tableRowOf(PAUSED)).toBeUndefined();
    expect(tableRowOf(EXPERTS_OFF)).toBeUndefined();
    expect(tableInstrument(parse(EXPERTS_OFF))).toBeNull();
    expect(tableInstrument(parse({ ...FAST_ORD_490, table: FULL_ORD_501.table }))).toBeNull();
    expect(tableInstrument(null)).toBeNull();
  });

  it('counts the flags from the records: late once, each waiting disagreement, each gap until the freeze', () => {
    expect(tableFlags(withTable(FULL_ORD_501))).toBe(0);
    expect(tableFlags(withTable(LATE_TABLE))).toBe(1);
    expect(tableFlags(withTable(ord501At('ruled')))).toBe(2);
    expect(isOpenConflict(parse(ord501At('ruled')), 'Customer email in the export')).toBe(true);
    expect(isOpenConflict(parse(FULL_ORD_501), 'Customer email in the export')).toBe(false);
  });

  it('says the live state in words while the table sits', () => {
    expect(
      ORD_501_SEQUENCE.map((raw) => tableRowOf(raw)!.split(' / ').slice(0, 2).join(' / ')),
    ).toEqual([
      'HIGH TABLE  7 standing / ○ ○ ○ ○ ○ ○ ○ │ ◇',
      'HIGH TABLE  0 of 7 notes / ◉ ◉ ◉ ◉ ◉ ◉ ◉ │ ◇',
      'HIGH TABLE  3 of 7 notes / ● ◉ ● ● ◉ ◉ ◉ │ ◇',
      'HIGH TABLE  chief is ruling / ● ● ● ● ● ● ● │ ◇',
      'HIGH TABLE  needs answers / ● ● ● ● ● ● ● │ ◆',
      'HIGH TABLE  spec approved / ● ● ● ● ● ● ● │ ◆',
    ]);
  });

  it('reads skipped for a hand-written spec, and standing with nobody seated', () => {
    expect(tableRowOf(SKIPPED_TABLE)).toBe('HIGH TABLE  skipped');
    const empty = {
      ...GRADUATED_ORD_482,
      table: { ...(SKIPPED_TABLE.table as Raw), skipped: false },
    };
    expect(tableRowOf(empty)).toBe('HIGH TABLE  0 standing / │ ◇ /   CA');
  });

  it('names seats by two letters, with the chief last after a separator', () => {
    expect(roleInitials('product-owner')).toBe('PO');
    expect(roleInitials('devops-engineer')).toBe('DO');
    expect(roleInitials('skill-orchestrator')).toBe('SO');
    expect(roleInitials('agent-orchestrator')).toBe('AO');
    expect(roleInitials('db-expert')).toBe('DE');
    expect(roleInitials('auditor')).toBe('AU');
  });

  it('the label opens the High Table tab, the marks carry their state colour and the chief turns amber when it needs answers', () => {
    const block = blockOf(bandOf(ord501At('landing')), 'paqad-instrument-table')!;
    expect(block.title[0]).toMatchObject({ text: 'HIGH TABLE', opens: 'table', dim: true });
    expect(block.cells.slice(0, 7).map((cell) => cell.top.tone)).toEqual([
      'good',
      'working',
      'good',
      'good',
      'working',
      'working',
      'working',
    ]);
    const late = blockOf(bandOf(LATE_TABLE), 'paqad-instrument-table')!;
    expect(late.cells.filter((cell) => cell.top.tone === 'warn')).toHaveLength(1);
    const asking = blockOf(bandOf(ord501At('ruled')), 'paqad-instrument-table')!;
    expect(asking.cells.at(-1)?.top).toMatchObject({ text: '◆', tone: 'needs-you' });
    expect(asking.title[1]).toMatchObject({ tone: 'warn' });
  });
});

describe('the live card (FR-25, AC-58)', () => {
  it('matches only a paqad-ai spec pipeline experts Bash call', () => {
    expect(isExpertsCall('Bash', { command: 'pnpm exec paqad-ai spec pipeline experts --x' })).toBe(
      true,
    );
    expect(isExpertsCall('Bash', { command: 'paqad-ai spec pipeline questions' })).toBe(false);
    expect(isExpertsCall('Read', { command: 'paqad-ai spec pipeline experts' })).toBe(false);
    expect(isExpertsCall('Bash', {})).toBe(false);
    expect(isExpertsCall('Bash', null)).toBe(false);
  });

  it('keys the card by the change, or the session while no change is known', () => {
    expect(cardKey(parse(FULL_ORD_501))).toBe('ORD-501-id');
    expect(cardKey(parse({ ...FULL_ORD_501, change: { issue: 'ORD-501' } }))).toBe('ORD-501');
    expect(cardKey(null)).toBe('session');
  });

  it('draws seats with state and time, tokens only once the note lands, and the chief line', () => {
    const writing = cardText(ord482At('writing'), Date.parse('2026-10-18T08:21:01.000Z'));
    expect(writing).toEqual([
      'High Table · 4 seats · 4 writing',
      '  ◐ Product owner: writing for 1m 00s',
      '  ◐ Application architect: writing for 1m 00s',
      '  ◐ User flow writer: writing for 59s',
      '  ◐ QA engineer: writing for 59s',
      '  ○ Chief architect: not seated yet',
    ]);
    const ruled = cardText(FULL_ORD_501);
    expect(ruled[0]).toBe('High Table · 7 seats · the chief architect ruled: proceed');
    expect(ruled).toContain(
      '  ● QA engineer: done in 2m 14s, Note: ~900 tokens of its 4K budget. Run: 24K tokens, mostly the code it read (exact), 2 findings',
    );
    expect(ruled).toContain(
      '  ● Performance analyst: done in 2m 22s, Note: ~1.9K tokens of its 5K budget, 1 finding',
    );
    expect(ruled.at(-1)).toBe(
      'Verdict: proceed. 13 findings, 9 accepted, 1 declined, 1 renamed, 1 disagreement, 1 settled before, 1 gap.',
    );
  });

  it('marks a late seat in amber words and says the table is credited with nothing', () => {
    const lines = tableCardLines(withTable(LATE_TABLE).table, NOW);
    const security = lines.find((line) => text(line).includes('Security auditor'))!;
    expect(security.at(-1)).toEqual({
      text: ', late: its note landed after the spec was frozen',
      tone: 'warn',
    });
    expect(text(lines.at(-1)!)).toBe(
      'The High Table met after the spec was frozen, so no spec line is credited to it.',
    );
  });

  it('says a skipped table is skipped, and labels tokens exact or estimate', () => {
    expect(cardText(SKIPPED_TABLE)).toEqual([SKIPPED_TEXT]);
    const seat = withTable(FULL_ORD_501).table.seats[0]!;
    expect(seatTokens(seat)).toBe(
      'Note: ~900 tokens of its 4K budget. Run: 21.4K tokens, mostly the code it read (exact)',
    );
    expect(seatTokens({ ...seat, tokens_exact: false })).toBe(
      'Note: ~900 tokens of its 4K budget. Run: 21.4K tokens, mostly the code it read (estimate)',
    );
    expect(seatTokens({ ...seat, tokens: null, budget_tokens: null })).toBe('Note: ~900 tokens');
    expect(seatTokens({ ...seat, tokens: null, tokens_estimate: null })).toBeNull();
  });

  it('AC-22: never prints a note budget and run tokens side by side unlabelled', () => {
    const seat = {
      ...withTable(FULL_ORD_501).table.seats[0]!,
      budget_tokens: 8000,
      tokens_estimate: 6200,
      tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0, total: 230490 },
      tokens_exact: true,
    };
    expect(noteTokens(seat)).toBe('Note: ~6.2K tokens of its 8K budget');
    expect(runTokens(seat)).toBe('Run: 230K tokens, mostly the code it read (exact)');
  });
});

describe("the pane's High Table tab (FR-26, AC-59)", () => {
  it('AC-59: ORD-501 shows seven seats with reasons, the rulings, the questions and 12 credits', () => {
    const lines = paneText(FULL_ORD_501);
    for (const plan of ORD_501_SEATS) {
      expect(
        lines.some(
          (line) =>
            line.includes(`${roleWords(plan.role)}: `) && line.includes(`Why: ${plan.reason}`),
        ),
      ).toBe(true);
    }
    expect(lines).toEqual(
      expect.arrayContaining([
        '  Declined: EX-performance-analyst-1. Reason: Streaming the file is out of scope for the first version; exports stop at 10,000 rows.',
        '  Renamed: EX-user-flow-writer-1 now reads "Export orders".',
        '  Disagreement: Customer email in the export. The chief architect recommends: leave the email out by default and let an admin turn it on. Why: The security auditor wants it masked and the product owner wants it for support; an opt-in keeps both.',
        `  Settled before: Date range limit. Chosen: 90 days at most. Decided on 2026-10-02 in ${SETTLED_DECISION}, so nobody was asked again.`,
        '  Gap no expert covered: File retention. A generated file with customer data could linger. Question for you: How long should a generated export file be kept?',
        `  Answered from an earlier decision: Which file format should the export use? Source: ${AUTO_ANSWER_DECISION}.`,
        'Who shaped the spec (12 lines):',
        '  FR-1: Product owner, User flow writer',
        '  INV-2: QA engineer, Product owner',
      ]),
    );
    expect(lines.filter((line) => /^ {2}(FR|NFR|INV)-\d+: /.test(line))).toHaveLength(12);
  });

  it('shows the picked seat in detail: origin, reason, budget and clamp, tokens with their label, findings', () => {
    expect(paneText(FULL_ORD_501, 'db-expert')).toEqual(
      expect.arrayContaining([
        'DB expert, picked for this change.',
        'Why: the export reads every order in a date range',
        'State: done in 2m 48s.',
        'Run: 26.5K tokens, mostly the code it read (exact).',
        'Findings: 2.',
      ]),
    );
    expect(paneText(FULL_ORD_501, 'qa-engineer')).toContain(
      'Note: ~900 tokens of its 4K budget, within the ceiling.',
    );
    expect(paneText(FULL_ORD_501, 'chief-architect')).toEqual(
      expect.arrayContaining([
        'Chief architect, chairs the table.',
        'State: ruled in 2m 00s, verdict: proceed.',
      ]),
    );
    const view = tablePaneView(withTable(ord501At('writing')), 'nobody', NOW);
    expect(view.buttons[0]).toMatchObject({ role: 'product-owner', selected: true });
    expect(view.buttons[0]!.label).toBe('Product owner (shown)');
    expect(view.detail.map(text)).toEqual(
      expect.arrayContaining([
        'Note: not written yet, its budget is 4K tokens, within the ceiling.',
        'Findings: not yet.',
      ]),
    );
    expect(view.buttons.map((b) => b.key)).not.toContain('paqad-seat-chief-architect');
    const ruled = tablePaneView(withTable(FULL_ORD_501), null, NOW);
    expect(ruled.buttons.at(-1)).toMatchObject({
      key: 'paqad-seat-chief-architect',
      label: 'Chief architect',
    });
  });

  it('reads a waiting disagreement as open and a late seat in amber words', () => {
    const lines = paneText(ord501At('ruled'));
    expect(
      lines.some(
        (line) =>
          line.startsWith('  Open disagreement: Customer email in the export.') &&
          line.endsWith('The choice is yours.'),
      ),
    ).toBe(true);
    expect(lines).toContain('Who shaped the spec');
    expect(lines).toContain(
      'Shown when the spec is frozen: each spec line with the experts who shaped it.',
    );
    const late = tablePaneView(withTable(LATE_TABLE), 'security-auditor', NOW);
    expect(late.detail.at(-1)).toEqual([
      {
        text: 'Late: its note landed after the spec was frozen, so it shaped no spec line.',
        tone: 'warn',
      },
    ]);
    expect(late.rulings.at(-1)).toEqual([
      {
        text: 'Who shaped the spec: no spec line. The High Table met after the spec was frozen.',
        tone: 'warn',
      },
    ]);
  });

  it('before the chief rules, says so; with no expert line, says that', () => {
    expect(paneText(ord501At('writing'))).toContain(
      '  Not yet. The chief architect rules once every seat has written.',
    );
    const uncredited = { ...FULL_ORD_501, table: { ...(FULL_ORD_501.table as Raw), credits: [] } };
    expect(paneText(uncredited)).toContain(
      'Who shaped the spec: no spec line came from an expert.',
    );
  });

  it('draws the round table: one arc per seat by state, the chief at the centre, alt text in words', () => {
    const table = withTable(ord501At('landing')).table;
    const svg = tableSvg(table);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.match(/<path /g)).toHaveLength(7);
    expect(svg.match(new RegExp(SEAT_COLOR.done, 'g'))).toHaveLength(3);
    expect(svg.match(new RegExp(SEAT_COLOR.writing, 'g'))).toHaveLength(4);
    expect(svg).toContain('<title>Product owner done</title>');
    expect(svg).toContain('<title>Chief architect not seated yet</title>');
    const late = tableSvg(withTable(LATE_TABLE).table);
    expect(late).toContain(`stroke="${SEAT_COLOR.late}"`);
    expect(late).toContain('<title>Security auditor done, late</title>');
    const view = tablePaneView(withTable(FULL_ORD_501), null, NOW);
    expect(view.svg.alt).toBe(
      'The High Table: the chief architect at the centre, ruled: proceed. 7 seats around it: Product owner done, Application architect done, User flow writer done, QA engineer done, Security auditor done, DB expert done, Performance analyst done.',
    );
    expect(view.ring.map(text)).toEqual([
      'High Table: ● Chief architect at the centre, 7 seats around it',
      '  ● ● ● ● ● ● ●  7 done',
    ]);
    const one = tableSvg({ ...table, seats: [{ ...table.seats[0]!, role: 'a<b' }], chief: null });
    expect(one).toContain('<title>A&#60;b done</title>');
    expect(one).toContain(' 0 1 1 ');
  });

  it('AC-32: shows Who shaped the spec on its tab, and says why when there is no table', () => {
    expect(PANE_TABS.map((tab) => tab.label)).toEqual([
      'Trust',
      'High Table',
      'Ships',
      'Record',
      'Cost',
    ]);
    const writing = buildPaneView(parse(ord501At('writing')), 'table', { now: NOW });
    expect(writing.tabs.find((tab) => tab.selected)?.id).toBe('table');
    expect(writing.table).not.toBeNull();
    expect(writing.table!.rulings.map(text)).toContain('Who shaped the spec');
    expect(buildPaneView(parse(ord501At('writing')), null).tabs[0]!.selected).toBe(true);
    expect(buildPaneView(parse(FAST_ORD_490), 'table').lines).toEqual([
      'The fast lane seats no High Table.',
    ]);
    expect(buildPaneView(parse(EXPERTS_OFF), 'table').lines).toEqual([
      'No High Table for this change: the experts are off or not seated yet.',
    ]);
    expect(buildPaneView(parse(SKIPPED_TABLE), 'table')).toMatchObject({
      lines: [SKIPPED_TEXT],
      table: null,
    });
    expect(noTableText(null)).toBe('Not yet. paqad has no record for this session.');
    expect(noTableText(parse(PAUSED))).toBe(
      'No change is in progress, so there is no High Table to show.',
    );
  });

  it("shows a seat's track record in words, and leaves the line out with no history", () => {
    expect(paneText(FULL_ORD_501, 'product-owner')).toContain(
      'Track record: on 6 earlier changes, changed the spec on 4, had nothing to add on 1, about 2,300 tokens each.',
    );
    expect(paneText(FULL_ORD_501, 'db-expert').join('\n')).not.toContain('Track record');
    expect(paneText(FULL_ORD_501, 'chief-architect').join('\n')).not.toContain('Track record');
    expect(trackRecordWords({ changes: 1, changed_spec: 0, empty: 0, avg_tokens: 0 })).toBe(
      'Track record: on 1 earlier change, changed the spec on 0.',
    );
    const seatsWith = (record: unknown) =>
      parse({
        ...FULL_ORD_501,
        table: {
          ...(FULL_ORD_501.table as Raw),
          seats: [{ role: 'qa-engineer', track_record: record }],
        },
      }).table!.seats[0]!.track_record;
    expect(seatsWith({ changes: 0, changed_spec: 0 })).toBeNull();
    expect(seatsWith('nope')).toBeNull();
    expect(seatsWith({ changes: 2, changed_spec: -1 })).toEqual({
      changes: 2,
      changed_spec: 0,
      empty: 0,
      avg_tokens: 0,
    });
  });

  it('reads the day a decision was recorded from its id, and nothing from any other id', () => {
    expect(decisionDate(SETTLED_DECISION)).toBe('2026-10-02');
    expect(decisionDate(AUTO_ANSWER_DECISION)).toBe('2026-09-24');
    expect(decisionDate('D-01J1')).toBeNull();
    expect(decisionDate('not a decision')).toBeNull();
    const undated = {
      ...FULL_ORD_501,
      table: {
        ...(FULL_ORD_501.table as Raw),
        rulings: {
          ...((FULL_ORD_501.table as Raw).rulings as Raw),
          settled: [{ target: 'Range', chosen: '90 days', source: 'D-01J1' }],
        },
      },
    };
    expect(paneText(undated)).toContain(
      '  Settled before: Range. Chosen: 90 days. Decided in D-01J1, so nobody was asked again.',
    );
  });
});

describe('the High Table as it moves (AC-60, AC-61)', () => {
  const stateOf = (lines: string[], role: string) => {
    const line = lines.find((l) => l.includes(` ${roleWords(role)}: `));
    return /: (seated|writing|done)/.exec(line ?? '')?.[1];
  };

  it('AC-60: each ORD-501 seat goes seated, writing, done, in order, in the card and the pane', () => {
    for (const plan of ORD_501_SEATS) {
      for (const lines of [cardText, paneText] as const) {
        const seen: string[] = [];
        for (const raw of ORD_501_SEQUENCE) {
          const state = stateOf(lines(raw), plan.role)!;
          if (seen.at(-1) !== state) seen.push(state);
        }
        expect(seen, plan.role).toEqual(['seated', 'writing', 'done']);
      }
    }
  });

  it("AC-61: ORD-482 seats write in parallel, each one's tokens land with its note, then only dots", () => {
    const [writing, landing, ruled] = ORD_482_SEQUENCE.map((raw) => cardText(raw));
    expect(
      writing!.slice(1, 5).every((line) => line.includes('writing') && !line.includes('tokens')),
    ).toBe(true);
    expect(landing!.slice(1, 5).map((line) => line.includes('(exact)'))).toEqual([
      true,
      false,
      true,
      false,
    ]);
    expect(ruled!.slice(1, 5).every((line) => line.includes('(exact)'))).toBe(true);
    expect(ORD_482_SEQUENCE.map(tableRowOf)).toEqual([
      'HIGH TABLE  0 of 4 notes / ◉ ◉ ◉ ◉ │ ◇ / PO AA UF QA   CA',
      'HIGH TABLE  2 of 4 notes / ● ◉ ● ◉ │ ◇ / PO AA UF QA   CA',
      'HIGH TABLE  spec approved / ● ● ● ● │ ◆ / PO AA UF QA   CA',
    ]);
  });
});

const COPY_FIXTURES: Raw[] = [
  ...Object.values(STATE_FIXTURES),
  ...ORD_501_SEQUENCE,
  ...ORD_482_SEQUENCE,
  LATE_TABLE,
  SKIPPED_TABLE,
  EXPERTS_OFF,
  FAST_ORD_490,
];

function allLines(): TableLine[] {
  const lines: TableLine[] = [];
  for (const raw of COPY_FIXTURES) {
    const snap = parse(raw);
    for (const line of layoutLines(bandOf(raw, 200, 12))) lines.push([{ text: line }]);
    void snap;
    for (const tab of ['table', 'cost'] as const) {
      const view = buildPaneView(snap, tab, { now: NOW });
      lines.push([{ text: view.tabs.map((t) => t.label).join(' ') }]);
      lines.push(...view.lines.map((line) => [{ text: line }]));
      if (view.table) {
        lines.push(
          ...view.table.ring,
          ...view.table.seats,
          ...view.table.detail,
          ...view.table.rulings,
        );
        lines.push(...view.table.buttons.map((b) => [{ text: b.label }]));
        lines.push([{ text: view.table.svg.alt }]);
      }
    }
    if (showsTable(snap)) lines.push(...tableCardLines(snap.table, NOW));
  }
  return lines;
}

const PROPER =
  /^(High|Table|Chief|QA|DB|UX|UI|API|DevOps|D-[0-9A-Z]+[.,]?|EX-[\w-]+[.,]?|(FR|NFR|INV)-\d+:?|Safe|Needs|Inconclusive|Build|Review|Next:|Spec|Stage|Ship|Merge|Edit|Commit|Push|PR|CI|Intake|Planning|Checks|Docs|Deliver)$/;

describe('AC-62: the High Table copy', () => {
  const lines = allLines();

  it('has no em dash anywhere', () => {
    for (const line of lines) expect(text(line)).not.toContain('—');
  });

  it('starts each line in sentence case and keeps labels in sentence case', () => {
    for (const line of lines) {
      const words = text(line).replace(/^[\s○◐●✓▸·~✗-]+/, '');
      if (words === '' || /^(paqad|cost:)/.test(words) || /^\d/.test(words)) continue;
      expect(words[0], words).toBe(words[0]!.toUpperCase());
    }
    const labels = [
      ...PANE_TABS.map((tab) => tab.label),
      ...tablePaneView(withTable(FULL_ORD_501), null, NOW).buttons.map((b) =>
        b.label.replace(' (shown)', ''),
      ),
    ];
    for (const label of labels) {
      const [first, ...rest] = label.split(' ');
      expect(first![0], label).toBe(first![0]!.toUpperCase());
      for (const word of rest)
        expect(word === word.toLowerCase() || PROPER.test(word), label).toBe(true);
    }
  });

  it('uses the three verdict words exactly, never another casing', () => {
    const all = lines.map(text).join('\n');
    for (const word of Object.values(VERDICT_WORDS)) {
      const any = new RegExp(word, 'gi');
      for (const hit of all.match(any) ?? []) expect(hit).toBe(word);
    }
  });

  it('carries nothing by colour alone: every coloured part has words or a state glyph, and amber dots ride with words', () => {
    const glyphs = new Set(Object.values(SEAT_MARK));
    for (const line of lines) {
      for (const segment of line) {
        if (!segment.tone) continue;
        expect(segment.text.trim().length, text(line)).toBeGreaterThan(0);
        if (!glyphs.has(segment.text)) expect(segment.text, text(line)).toMatch(/[A-Za-z0-9]/);
      }
      if (line.some((s) => glyphs.has(s.text) && s.tone === 'warn')) {
        expect(text(line)).toMatch(/flag|late/);
      }
    }
    expect(new Set(Object.values(SEAT_MARK)).size).toBe(3);
  });
});
