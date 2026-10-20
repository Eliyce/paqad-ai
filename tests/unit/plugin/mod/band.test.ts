import { describe, expect, it } from 'vitest';

import {
  layoutBand,
  rowText,
  truncateRow,
  type BandRow,
} from '../../../../runtime/claude-plugin/mod/band.ts';
import { buildBandView, parseSnapshot } from '../../../../runtime/claude-plugin/mod/model.ts';
import {
  EXPERTS_OFF,
  FAST_ORD_490,
  FULL_ORD_501,
  GRADUATED_ORD_482,
  NOW,
  PAUSED,
  STATE_FIXTURES,
  fileText,
} from '../../../../runtime/claude-plugin/mod/test/fixtures.ts';

const view = (raw: Record<string, unknown> | null) =>
  buildBandView(raw ? parseSnapshot(fileText(raw)) : null, NOW);
const lines = (raw: Record<string, unknown> | null, columns = 95, maxRows = 12) =>
  layoutBand(view(raw), { columns, maxRows }).map(rowText);

describe('the band rows (FR-26)', () => {
  it('draws the headline, Stage, the High Table, Ship and the pills', () => {
    expect(lines(FULL_ORD_501)).toEqual([
      'paqad · Safe to merge · 1 flag open.',
      'Stage  6 of 8 done  ·Intake ✓Planning ✓Spec ✓Build ✓Review ✓Checks ✓Docs ·Deliver',
      'High Table  ●●●●●●● chief ●',
      'Ship   3 commits  ✓Edit ✓Commit ·Push ·PR ·CI ·Merge (yours)',
      '1 flag · cost: not yet',
    ]);
    for (const raw of [FAST_ORD_490, PAUSED]) {
      expect(lines(raw).join('\n')).not.toContain('High Table');
    }
    expect(lines(GRADUATED_ORD_482)[2]).toBe('High Table  ●●●● chief ●');
  });

  it('shows the running stage with its clock, and the fast lane Spec as not required', () => {
    const [head, stage, ship] = lines(FAST_ORD_490);
    expect(head).toBe('paqad · Working · Build in progress. Next: Review.');
    expect(stage).toBe(
      'Stage  Build running 2m 00s  ·Intake ✓Planning -Spec ▸Build ·Review ·Checks ·Docs ·Deliver',
    );
    expect(ship).toBe('Ship   Edit running  ▸Edit ·Commit ·Push ·PR ·CI ·Merge (yours)');
  });

  it('reads "not yet" for every instrument with no record (AC-42)', () => {
    expect(lines(null)).toEqual([
      'paqad · Ready · Not yet. paqad has no record for this session.',
      'Stage  not yet',
      'Ship   not yet  ·Edit ·Commit ·Push ·PR ·CI ·Merge (yours)',
      'cost: not yet',
    ]);
    expect(lines(PAUSED)[0]).toBe(
      'paqad · Paused · A change is paused. Say "continue" to pick it up.',
    );
  });

  it('reads the furthest ship step that is recorded', () => {
    const shipped = {
      ...FULL_ORD_501,
      ship: { commits: 2, push: 'pushed', pr: 'draft', ci: '4 of 4', merge_commit: 'abc' },
    };
    const ship = (raw: Record<string, unknown>) =>
      lines(raw).find((line) => line.startsWith('Ship'));
    expect(ship(shipped)).toBe('Ship   Merge merged  ✓Edit ✓Commit ✓Push ✓PR ✓CI ✓Merge');
    const edited = { ...FULL_ORD_501, ship: null };
    expect(ship(edited)).toBe('Ship   Edit done  ✓Edit ·Commit ·Push ·PR ·CI ·Merge (yours)');
  });

  it('colours the state and the flag pill, and says both in words', () => {
    const [head, , , , pills] = layoutBand(view(FULL_ORD_501), { columns: 95, maxRows: 12 });
    expect(head!.find((s) => s.text === 'Safe to merge')?.tone).toBe('warn');
    expect(pills!.find((s) => s.text === '1 flag')?.tone).toBe('warn');
  });
});

describe('the terminal band fits its box (FR-28, AC-43)', () => {
  const STATES = Object.values(STATE_FIXTURES);
  for (const columns of [40, 71, 95]) {
    for (const maxRows of [3, 12]) {
      it(`${columns} columns, ${maxRows} rows`, () => {
        for (const raw of [...STATES, FULL_ORD_501, FAST_ORD_490]) {
          const out = lines(raw, columns, maxRows);
          expect(out.length).toBeLessThanOrEqual(maxRows);
          for (const line of out) expect([...line].length).toBeLessThanOrEqual(columns);
        }
      });
    }
  }

  it('keeps the state and the flag count on the headline when rows are short', () => {
    expect(lines(FULL_ORD_501, 40, 3)).toEqual([
      'paqad · Safe to merge · 1 flag · cost: …',
      'Stage  6 of 8 done  ·Intake ✓Planning ✓…',
      'High Table  ●●●●●●● chief ●',
    ]);
    expect(lines(EXPERTS_OFF, 95, 4).at(-1)).toBe('cost: not yet');
    expect(lines(FULL_ORD_501, 95, 4)[0]).toContain('1 flag · cost: not yet');
    expect(lines(FULL_ORD_501, 95, 1)).toEqual([
      'paqad · Safe to merge · 1 flag · cost: not yet · 1 flag open.',
    ]);
  });

  it('says each state in words, never by colour alone', () => {
    for (const [state, raw] of Object.entries(STATE_FIXTURES)) {
      expect(lines(raw, 40, 3)[0]).toContain(state);
    }
  });

  it('cuts a row with an ellipsis and never wraps', () => {
    const row: BandRow = [{ text: 'abcdef', tone: 'good' }, { text: 'ghij' }];
    expect(truncateRow(row, 20)).toBe(row);
    expect(truncateRow(row, 5)).toEqual([{ text: 'abcd', tone: 'good' }, { text: '…' }]);
    expect(truncateRow(row, 7)).toEqual([{ text: 'abcdef', tone: 'good' }, { text: '…' }]);
    expect(rowText(truncateRow(row, 0))).toBe('…');
  });

  it('never uses an em dash', () => {
    for (const raw of [...Object.values(STATE_FIXTURES), null]) {
      expect(lines(raw).join('\n')).not.toContain('—');
    }
  });
});
