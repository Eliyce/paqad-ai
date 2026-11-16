import { describe, expect, it } from 'vitest';

import { emptyStages } from '@/onboarding/journey/run-store.js';
import type { JourneyRun } from '@/onboarding/journey/types.js';
import { buildView } from '@/onboarding/journey/view.js';
import { layoutBand, rowText } from '../../../runtime/claude-plugin/mod/band.ts';
import { STAGE_MARK } from '../../../runtime/claude-plugin/mod/instruments.ts';
import {
  COMMIT_LATER,
  ONBOARDING_ROUTE,
  journeyCardTone,
  onboardingBody,
} from '../../../runtime/claude-plugin/mod/journey-card.ts';
import {
  parseJourneyView,
  type JourneyView,
} from '../../../runtime/claude-plugin/mod/journey-model.ts';
import { parseSnapshot } from '../../../runtime/claude-plugin/mod/model.ts';
import { BAND_BODIES, type BandLayout } from '../../../runtime/claude-plugin/mod/shell.ts';
import { FULL_ORD_501, fileText } from '../../../runtime/claude-plugin/mod/test/fixtures.ts';
import { layoutLines } from '../plugin/mod/band-text.ts';

import { at, baseRun, clockAt, unitRow } from '../onboarding/journey/fixtures/journey.js';

const MODULES = Array.from({ length: 23 }, (_, i) => (i === 7 ? 'billing' : `m${i + 1}`));
const FIRST = {
  detect: { status: 'done' as const },
  setup: { status: 'done' as const },
  project_docs: { status: 'done' as const },
};

function run(stages: Partial<JourneyRun['stages']>, extra: Partial<JourneyRun> = {}): JourneyRun {
  return { ...baseRun({ stages: { ...emptyStages(), ...stages }, ...extra }), revision: 2 };
}

function viewAt(minute: number, journey: JourneyRun, rows = [] as Parameters<typeof buildView>[1]) {
  return parseJourneyView(JSON.stringify(buildView(journey, rows, { now: clockAt(minute) })))!;
}

function card(view: JourneyView, minute: number, columns = 120, extra = {}): BandLayout {
  return layoutBand(
    null,
    { columns, maxRows: 14 },
    { now: Date.parse(at(minute)), surface: 'terminal', journey: view },
    extra as never,
  );
}

function running(): JourneyView {
  const rows = MODULES.slice(0, 7).map((slug, i) => unitRow('module_docs', slug, at((i + 1) * 3)));
  return viewAt(
    22,
    run({ ...FIRST, module_docs: { status: 'running', started_at: at(0), plan: MODULES } }),
    rows,
  );
}

function allDone(extra: Partial<JourneyRun> = {}, gap = false): JourneyView {
  const stages = emptyStages();
  for (const id of Object.keys(stages) as Array<keyof typeof stages>) {
    stages[id] = { status: 'done' };
  }
  if (gap) stages.rules_discovery = { status: 'degraded', degraded: ['research_offline'] };
  return viewAt(3, run(stages, extra));
}

describe('AC-11 AC-13: the onboarding terminal card', () => {
  it('registers an onboarding body beside the feature body', () => {
    expect(BAND_BODIES[ONBOARDING_ROUTE]).toBe(onboardingBody);
  });

  it('AC-11 AC-12: running at 120 columns draws one card with the eight two-row cells', () => {
    const layout = card(running(), 22);
    expect(layout.kind).toBe('card');
    if (layout.kind !== 'card') return;
    expect(layout.tone).toBe('working');
    expect(layout.direction).toBe('row');
    expect(rowText(layout.header.left)).toContain('Onboarding · Step 4 of 8');
    const [block] = layout.blocks;
    expect(rowText(block!.title)).toBe('▸ Writing the module docs  7 of 23 · billing');
    expect(block!.cells.map((cell) => cell.top.text)).toEqual([
      STAGE_MARK.done.mark,
      '✓',
      '✓',
      '▸',
      '○',
      '○',
      '○',
      '○',
    ]);
    expect(block!.cells.map((cell) => cell.bottom.text)).toEqual([
      'Read',
      'Set up',
      'Docs',
      'Modules',
      'Research',
      'Triage',
      'Checks',
      'Wrap up',
    ]);
    expect(block!.cells[4]?.bottom.dim).toBe(true);
    expect(rowText(block!.note!)).toMatch(/^about \d+ (min|h) left$/u);
    expect(rowText(layout.footer!.left)).toBe('Ledger');
    expect(layoutLines(layout)).toMatchSnapshot();
  });

  it('AC-11: below 110 columns the cells wrap four and four', () => {
    const layout = card(running(), 22, 100);
    if (layout.kind !== 'card') throw new Error('expected a card');
    expect(layout.direction).toBe('column');
    expect(layout.blocks.map((block) => block.cells.map((cell) => cell.bottom.text))).toEqual([
      ['Read', 'Set up', 'Docs', 'Modules'],
      ['Research', 'Triage', 'Checks', 'Wrap up'],
    ]);
    expect(layoutLines(layout)).toMatchSnapshot();
  });

  it('AC-11: paused, stopped, stalled, question, done and done with a gap each draw their line and tone', () => {
    const paused = viewAt(1, run(FIRST, { status: 'paused' }));
    const stopped = viewAt(
      1,
      run({ ...FIRST, module_docs: { status: 'failed', started_at: at(0) } }, { status: 'failed' }),
    );
    const stalledView = viewAt(
      1,
      run({ ...FIRST, module_docs: { status: 'running', started_at: at(0) } }),
    );
    const asking = allDone();
    const done = allDone({ commit: { answer: 'branch', answered_at: at(2), branch: 'b' } });
    const gap = allDone({ commit: { answer: 'no', answered_at: at(2) } }, true);
    const cases: Array<[JourneyView, number, string, string]> = [
      [
        paused,
        1,
        'needs-you',
        '● Paused before Write the module docs · say "continue paqad onboarding"',
      ],
      [stopped, 1, 'bad', '✗ Write the module docs stopped · say "continue paqad onboarding"'],
      [stalledView, 40, 'bad', '✗ Write the module docs stopped · say "continue paqad onboarding"'],
      [asking, 3, 'needs-you', '● Waiting for your answer · commit these changes on a new branch?'],
      [done, 3, 'good', '✓ Onboarding done · committed'],
      [gap, 3, 'warn', '◐ Onboarding done with 1 gap'],
    ];
    for (const [view, minute, tone, line] of cases) {
      const layout = card(view, minute);
      if (layout.kind !== 'card') throw new Error(`expected a card for ${view.status}`);
      expect(layout.tone, view.status).toBe(tone);
      expect(rowText(layout.blocks[0]!.title), view.status).toBe(line);
      expect(layoutLines(layout), view.status).toMatchSnapshot();
    }
    const askingCard = card(asking, 3) as Extract<BandLayout, { kind: 'card' }>;
    expect(rowText(askingCard.blocks[0]!.note!)).toBe(COMMIT_LATER);
    const gapCells = (card(gap, 3) as Extract<BandLayout, { kind: 'card' }>).blocks[0]!.cells;
    expect(gapCells[4]?.top.text).toBe('◐');
    expect(journeyCardTone(gap, false)).toBe('warn');
  });

  it('AC-11: layoutBand checks the journey first, whatever the snapshot route says', () => {
    const snapshot = parseSnapshot(fileText(FULL_ORD_501));
    const layout = layoutBand(
      snapshot,
      { columns: 120, maxRows: 14 },
      { now: Date.parse(at(22)), surface: 'terminal', journey: running() },
    );
    expect(layout.kind).toBe('card');
    if (layout.kind === 'card') expect(rowText(layout.header.left)).toContain('Onboarding');
  });

  it('AC-11: minimised draws one line and an old finished journey falls back to the normal band', () => {
    const minimised = card(running(), 22, 120, { minimised: true, closed: false, hidden: false });
    expect(minimised.kind).toBe('line');
    if (minimised.kind === 'line') {
      expect(rowText(minimised.row)).toContain('paqad  Onboarding · Step 4 of 8  ▸ Writing');
    }
    const closed = card(running(), 22, 120, { minimised: false, closed: true, hidden: false });
    if (closed.kind === 'line') expect(rowText(closed.row)).toContain('paqad · Onboarding ▸');
    const old = allDone({ commit: { answer: 'branch', answered_at: at(2), branch: 'b' } });
    expect(layoutLines(card(old, 3 + 31)).join('\n')).not.toContain('Onboarding');
  });
});
