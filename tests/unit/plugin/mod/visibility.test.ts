import { describe, expect, it } from 'vitest';

import { layoutBand } from '../../../../runtime/claude-plugin/mod/band.ts';
import { buildBandView, parseSnapshot } from '../../../../runtime/claude-plugin/mod/model.ts';
import { runPaqadCommand } from '../../../../runtime/claude-plugin/mod/commands.ts';
import {
  CLOSED_HINT,
  HIDDEN_HINT,
  HIDDEN_KEY_PREFIX,
  SHOWN_AGAIN,
  STORE_KEY_LIMIT,
  closedLine,
  hiddenKey,
  minimisedLine,
  needsYou,
  needsYouLine,
  readBandVisibility,
  visibilityMode,
} from '../../../../runtime/claude-plugin/mod/visibility.ts';
import {
  FAST_ORD_490,
  FULL_ORD_501,
  FULL_ORD_501_COST,
  GRADUATED_ORD_482,
  NOW,
  STOPPED,
  fileText,
} from '../../../../runtime/claude-plugin/mod/test/fixtures.ts';

import { layoutLines } from './band-text.ts';

const parse = (raw: Record<string, unknown>) => parseSnapshot(fileText(raw))!;
const text = (row: { text: string }[]) => row.map((segment) => segment.text).join('');
const lineAt = (raw: Record<string, unknown>, columns: number) => {
  const snap = parse(raw);
  return text(minimisedLine(snap, buildBandView(snap, NOW), columns, NOW));
};
const layout = (
  raw: Record<string, unknown>,
  visibility: { minimised: boolean; closed: boolean; hidden: boolean },
) =>
  layoutLines(
    layoutBand(
      parse(raw),
      { columns: 120, maxRows: 12 },
      { now: NOW, surface: 'terminal' },
      visibility,
    ),
  );

describe('the visibility state (FR-46 to FR-49)', () => {
  it('reads one precedence: hidden beats closed, closed beats minimised', () => {
    const at = (minimised: boolean, closed: boolean, hidden: boolean) =>
      visibilityMode(readBandVisibility({ minimised, hidden }, closed));
    expect(at(false, false, false)).toBe('band');
    expect(at(true, false, false)).toBe('minimised');
    expect(at(true, true, false)).toBe('closed');
    expect(at(true, true, true)).toBe('hidden');
    expect(readBandVisibility({ minimised: 'yes', hidden: 1 }, null)).toEqual({
      minimised: false,
      closed: false,
      hidden: false,
    });
  });

  it('keys Hide always by the project root, within the store key limit', () => {
    expect(hiddenKey('/work/a')).toBe(`${HIDDEN_KEY_PREFIX}/work/a`);
    expect(hiddenKey('/work/a')).not.toBe(hiddenKey('/work/b'));
    const long = hiddenKey(`/${'x'.repeat(400)}`);
    expect(long.length).toBeLessThanOrEqual(STORE_KEY_LIMIT);
    expect(long.startsWith(HIDDEN_KEY_PREFIX)).toBe(true);
  });

  it('needs you for a decision of this change or an unused rule stop', () => {
    expect(needsYou(parse(GRADUATED_ORD_482))).toBe(true);
    expect(needsYou(parse(STOPPED))).toBe(true);
    expect(needsYou(parse(FULL_ORD_501))).toBe(false);
    expect(needsYou(null)).toBe(false);
  });
});

describe('the minimised line (FR-46, FR-53, AC-46)', () => {
  it('carries the stage bar, the clock, the table, the ship step, flags and tokens', () => {
    expect(lineAt(FAST_ORD_490, 120)).toBe(
      'paqad ORD-490 Working ○●–▸○○○○ Build · 2:00 editing + Restore × Close',
    );
    expect(lineAt(FULL_ORD_501_COST, 200)).toBe(
      'paqad ORD-501 Safe to merge ○●●●●●●○ Docs · done High Table spec approved 3 of your commits 1 flag 1.3M tokens + Restore × Close',
    );
  });

  it('drops tokens, then the ship step, then the High Table count, then the stage bar, and never wraps', () => {
    const widths = [120, 100, 79, 60];
    expect(widths.map((columns) => lineAt(FULL_ORD_501_COST, columns))).toEqual([
      'paqad ORD-501 Safe to merge ○●●●●●●○ Docs · done High Table spec approved 3 of your commits 1 flag + Restore × Close',
      'paqad ORD-501 Safe to merge ○●●●●●●○ Docs · done High Table spec approved 1 flag + Restore × Close',
      'paqad ORD-501 Safe to merge ○●●●●●●○ Docs · done 1 flag + Restore × Close',
      'paqad ORD-501 Safe to merge 1 flag + Restore × Close',
    ]);
  });

  it('draws the minimised line in place of the card, with restore and close', () => {
    const lines = layout(FAST_ORD_490, { minimised: true, closed: false, hidden: false });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('+ Restore × Close');
  });
});

describe('closed, hidden and needs you (FR-47, FR-50, AC-36)', () => {
  it('replaces the band with a one-line entry that says how to bring it back', () => {
    expect(layout(FULL_ORD_501, { minimised: false, closed: true, hidden: false })).toEqual([
      `paqad · Safe to merge ▸  ${CLOSED_HINT}`,
    ]);
    expect(layout(FULL_ORD_501, { minimised: false, closed: true, hidden: true })).toEqual([
      `paqad · Safe to merge ▸  ${HIDDEN_HINT}`,
    ]);
    const view = buildBandView(parse(FULL_ORD_501), NOW);
    expect(closedLine('closed', view)[0]).toMatchObject({ action: 'reopen', hotkey: 'o' });
  });

  it('turns amber and reads Needs you while minimised, closed or hidden and paqad needs you', () => {
    for (const visibility of [
      { minimised: true, closed: false, hidden: false },
      { minimised: false, closed: true, hidden: false },
      { minimised: false, closed: false, hidden: true },
    ]) {
      expect(layout(GRADUATED_ORD_482, visibility)).toEqual(['paqad · Needs you ▸']);
    }
    expect(needsYouLine()[0]).toMatchObject({ tone: 'needs-you', action: 'show' });
    expect(
      layout(GRADUATED_ORD_482, { minimised: false, closed: false, hidden: false })[0],
    ).toContain('Needs you: 1 decision waiting.');
  });

  it('answers /paqad show', () => {
    expect(
      runPaqadCommand({ args: 'show', standDown: null, snapshot: null, receipt: null, now: NOW }),
    ).toEqual({ text: SHOWN_AGAIN });
  });
});
