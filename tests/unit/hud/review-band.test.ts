import { readdirSync, readFileSync } from 'node:fs';

import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

import { emptyStages } from '@/onboarding/journey/run-store.js';
import { buildView } from '@/onboarding/journey/view.js';
import { REVIEW_KINDS, type ReviewKind } from '@/review-runs/kinds.js';
import type { ReviewFinding, ReviewRun } from '@/review-runs/types.js';
import { buildReviewView } from '@/review-runs/view.js';
import { layoutBand, rowText } from '../../../runtime/claude-plugin/mod/band.ts';
import { drawDesktopBand } from '../../../runtime/claude-plugin/mod/desktop-band.tsx';
import { journeyCardTone } from '../../../runtime/claude-plugin/mod/journey-card.ts';
import {
  REVIEW_VIEW_PATHS,
  STALL_MS,
  journeyBand,
  journeyBandShown,
  newestShown,
  parseJourneyView,
  type JourneyView,
} from '../../../runtime/claude-plugin/mod/journey-model.ts';
import { INK, SIGNAL, STATUS_B } from '../../../runtime/claude-plugin/mod/palette.ts';
import { WORKFLOW_WORDS, workflowWords } from '../../../runtime/claude-plugin/mod/status-entry.ts';
import type { BandLayout } from '../../../runtime/claude-plugin/mod/shell.ts';

import { baseRun, clockAt } from '../onboarding/journey/fixtures/journey.js';
import { at, reviewRun } from '../review-runs/fixtures.js';

const MOD = join(__dirname, '../../../runtime/claude-plugin/mod');

function lead(severity: ReviewFinding['severity'], proof: ReviewFinding['proof'] = 'lead') {
  return { severity, proof, id: null, at: at(1) };
}

function viewOf(kind: ReviewKind, run: ReviewRun, minute = 1): JourneyView {
  return parseJourneyView(
    JSON.stringify(buildReviewView(kind, run, { now: () => new Date(at(minute)) })),
  )!;
}

function stopped(): JourneyView {
  return viewOf(
    REVIEW_KINDS.security,
    reviewRun({
      status: 'stopped',
      states: { scope: 'done', map: 'gap' },
      current_stage: 'map',
      stopped: { stage: 'map', was_running: true },
      gaps: [{ code: 'tool', stage: 'map', say: 'the crawler is missing', at: at(1) }],
      findings: [lead('high'), lead('low')],
    }),
  );
}

function runningDesign(): JourneyView {
  return viewOf(
    REVIEW_KINDS.design,
    reviewRun({
      kind: 'design',
      states: { scope: 'done', map: 'done', code: 'done', screens: 'running' },
      current_stage: 'screens',
    }),
  );
}

function finishedClean(): JourneyView {
  const states = Object.fromEntries(
    REVIEW_KINDS.security.stages.map((s) => [s.id, 'done' as const]),
  );
  return viewOf(
    REVIEW_KINDS.security,
    reviewRun({ status: 'finished', finished_at: at(1), states, findings: [lead('critical')] }),
    2,
  );
}

function texts(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  const props = (node as { props?: Record<string, unknown> }).props ?? {};
  return [...(typeof props.alt === 'string' ? [`alt:${props.alt}`] : []), ...texts(props.children)];
}

function find(
  node: unknown,
  match: (props: Record<string, unknown>) => boolean,
): Record<string, unknown>[] {
  if (node === null || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((child) => find(child, match));
  const props = (node as { props?: Record<string, unknown> }).props ?? {};
  return [...(match(props) ? [props] : []), ...find(props.children, match)];
}

(globalThis as { React?: unknown }).React = {
  createElement: (
    type: unknown,
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ) => ({
    type,
    props: { ...(props ?? {}), children },
  }),
};

const ui = new Proxy({}, { get: (_target, name) => String(name) }) as never;
const noop = () => undefined;

function draw(view: JourneyView, journey: (button: string, prompt?: string | null) => void = noop) {
  const band = {
    kind: 'onboarding' as const,
    model: journeyBand(view, { columns: 900, stalled: false }),
    columns: 900,
  };
  return drawDesktopBand(ui, band, 0, {
    ledger: noop,
    flags: noop,
    minimise: noop,
    expand: noop,
    close: noop,
    closeNow: noop,
    hideAlways: noop,
    cancel: noop,
    show: noop,
    signoff: noop,
    journey,
  });
}

function card(view: JourneyView, columns: number, extra = {}): BandLayout {
  return layoutBand(
    null,
    { columns, maxRows: 14 },
    { now: Date.parse(at(2)), surface: 'terminal', journey: view },
    extra as never,
  );
}

describe('the review band and card', () => {
  it('AC-20: a stopped security review draws its word, eight bars, Resume and a neutral leads footnote', () => {
    const prompts: Array<string | null | undefined> = [];
    const drawn = draw(stopped(), (_button, prompt) => void prompts.push(prompt));
    const words = texts(drawn).join('\n');
    expect(words).toContain('Security review');
    expect(words).toContain('Stopped at stage 2 · Map the attack surface · Resume to continue');
    expect(
      journeyBand(stopped(), { columns: 900, stalled: false }).marks.map((m) => m.label),
    ).toEqual(['Scope', 'Map', 'Scan', 'Threats', 'Hunt', 'Confirm', 'Sweep', 'Report']);
    const [button] = find(drawn, (props) => props.bordered === true);
    expect(button?.children).toEqual(['Resume']);
    (button!.onPress as () => void)();
    expect(prompts).toEqual(['continue paqad security review']);
    const [leads] = find(drawn, (props) => props.key === 'paqad-journey-leads');
    expect(leads?.children).toEqual(['2 leads, not confirmed']);
    expect(leads?.dimColor).toBe(true);
    expect(leads?.color).toBeUndefined();
    const [gap] = find(drawn, (props) => String(props.key ?? '').startsWith('paqad-gap-'));
    expect(gap?.wrap).toBe('truncate-end');
  });

  it('AC-21: a running design review card reads its identity row and wraps at 80 columns', () => {
    const wide = card(runningDesign(), 120);
    if (wide.kind !== 'card') throw new Error('expected a card');
    expect(rowText(wide.header.left)).toBe('paqad  Design review · Stage 4 of 8');
    expect(wide.blocks).toHaveLength(1);
    expect(wide.blocks[0]!.cells.map((cell) => cell.top.text)).toEqual([
      '✓',
      '✓',
      '✓',
      '▸',
      '○',
      '○',
      '○',
      '○',
    ]);
    expect(wide.blocks[0]!.cells[4]!.bottom.dim).toBe(true);
    expect(rowText(wide.footer!.left)).toBe('Ledger');
    expect(wide.tone).toBe('working');
    const narrow = card(runningDesign(), 80);
    if (narrow.kind !== 'card') throw new Error('expected a card');
    expect(narrow.blocks.map((block) => block.cells.map((cell) => cell.bottom.text))).toEqual([
      ['Scope', 'Map', 'Code', 'Screens'],
      ['Tasks', 'Judge', 'Confirm', 'Report'],
    ]);
    expect(rowText(narrow.blocks[1]!.title)).toBe('Stages 5 to 8');
    const minimised = card(runningDesign(), 120, { minimised: true, closed: false, hidden: false });
    if (minimised.kind !== 'line') throw new Error('expected one line');
    expect(rowText(minimised.row)).toBe(
      'paqad  Design review · Stage 4 of 8  ▸ Walking the screens',
    );
  });

  it('AC-22: the band alt names every stage state, the confirmed severity and the leads', () => {
    const view = viewOf(
      REVIEW_KINDS.security,
      reviewRun({
        states: { scope: 'done', map: 'skipped', scan: 'running' },
        current_stage: 'scan',
        findings: [lead('high', 'confirmed'), lead('low'), lead('info')],
      }),
    );
    expect(texts(draw(view)).join('\n')).toContain(
      'alt:Scope done, Map skipped, Scan running, 5 not started, 1 high finding confirmed, 2 leads',
    );
  });

  it('AC-16: a running view with no write for 20 minutes and one second draws stopped with Resume', () => {
    const view = runningDesign();
    const now = Date.parse(view.updated_at!) + STALL_MS + 1000;
    const stalled = card(view, 120);
    expect(stalled.kind).toBe('card');
    const model = journeyBand(view, { columns: 900, stalled: true });
    expect(model.headline).toEqual({
      row: 'S',
      text: 'Stopped at stage 4 · Walk the screens · Resume to continue',
      signal: 'caution',
    });
    expect(model.button).toBe('Resume');
    expect(model.prompt).toBe('continue paqad design review');
    const late = layoutBand(
      null,
      { columns: 120, maxRows: 14 },
      { now, surface: 'terminal', journey: view },
    );
    if (late.kind !== 'card') throw new Error('expected a card');
    expect(late.tone).toBe('warn');
    expect(rowText(late.blocks[0]!.title)).toBe(
      '▲ Walk the screens stopped · say "continue paqad design review"',
    );
  });

  it('AC-27: a finished review with nothing confirmed is muted, never success, and never celebrates', () => {
    const view = finishedClean();
    const model = journeyBand(view, { columns: 900, stalled: false });
    expect(model.headline.signal).toBe('muted');
    expect(model.celebrate).toBe(false);
    expect(journeyCardTone(view, false)).toBe('neutral');
    const [dot] = find(draw(view), (props) => props.key === 'paqad-review-dot');
    expect(dot?.dimColor).toBe(true);
    expect(dot?.color).toBeUndefined();
    const layout = card(view, 120);
    if (layout.kind !== 'card') throw new Error('expected a card');
    expect(layout.tone).toBe('neutral');
    expect(rowText(layout.blocks[0]!.title)).toBe('● No finding confirmed');
  });

  it('AC-28: the band draws from view.json alone, and the newest shown review wins', () => {
    const raw = JSON.stringify(
      buildReviewView(REVIEW_KINDS.security, reviewRun(), { now: () => new Date(at(0)) }),
    );
    const view = parseJourneyView(raw)!;
    expect(journeyBandShown(view, Date.parse(at(500)))).toBe(true);
    expect(texts(draw(view)).join('\n')).toContain('Security review has not started');
    const older = { ...view, updated_at: at(0) };
    const newer = { ...runningDesign(), updated_at: at(5) };
    expect(newestShown([older, newer], Date.parse(at(6)))?.word).toBe('Design review');
    expect(newestShown([null, finishedClean()], Date.parse(at(31)))).toBeNull();
    expect(newestShown([null, finishedClean()], Date.parse(at(30)))?.word).toBe('Security review');
    expect(Object.keys(REVIEW_VIEW_PATHS).sort()).toEqual(['design-test', 'pentest']);
  });

  it('AC-29: a skipped stage uses the not-required bar and cell, never caution', () => {
    const view = viewOf(
      REVIEW_KINDS.security,
      reviewRun({ states: { scope: 'done', map: 'skipped' }, current_stage: 'scope' }),
    );
    expect(journeyBand(view, { columns: 900, stalled: false }).marks[1]!.state).toBe('skip');
    const layout = card(view, 120);
    if (layout.kind !== 'card') throw new Error('expected a card');
    const cell = layout.blocks[0]!.cells[1]!;
    expect(cell.top).toEqual({ text: '–', dim: true });
  });

  it('AC-23: an onboarding view carries no word and keeps its onboarding defaults', () => {
    const run = {
      ...baseRun({ stages: { ...emptyStages(), detect: { status: 'failed', started_at: at(0) } } }),
      status: 'failed' as const,
      revision: 2,
    };
    const view = parseJourneyView(JSON.stringify(buildView(run, [], { now: clockAt(1) })))!;
    expect(view.word).toBeUndefined();
    const model = journeyBand(view, { columns: 900, stalled: false });
    expect(model.word).toBe('Onboarding');
    expect(model.review).toBe(false);
    expect(model.prompt).toBe('resume paqad onboarding');
    expect(model.leads).toBeNull();
    expect(find(draw(view), (props) => props.key === 'paqad-review-dot')).toEqual([]);
    const layout = card(view, 80);
    if (layout.kind !== 'card') throw new Error('expected a card');
    expect(rowText(layout.header.left)).toBe('paqad  Onboarding · Step 1 of 8');
    expect(rowText(layout.blocks[1]!.title)).toBe('Steps 5 to 8');
    expect(layout.tone).toBe('bad');
  });

  it('AC-24: the review routes read as security review and design review', () => {
    expect(workflowWords('pentest')).toBe('security review');
    expect(workflowWords('design-test')).toBe('design review');
    expect(WORKFLOW_WORDS.pentest).toBe('security review');
    expect(REVIEW_KINDS.security.route).toBe('pentest');
    expect(REVIEW_KINDS.design.route).toBe('design-test');
    expect(REVIEW_KINDS.security.prefix).toBe('PT-');
    expect(REVIEW_KINDS.design.prefix).toBe('DT-');
  });

  it('AC-25: no colour literal outside palette.ts and no new palette token', () => {
    const files = readdirSync(MOD).filter(
      (name) => /\.(ts|tsx)$/u.test(name) && name !== 'palette.ts' && !name.endsWith('.test.ts'),
    );
    for (const name of ['journey-model.ts', 'journey-card.ts', 'desktop-band.tsx', 'band.ts']) {
      expect(files).toContain(name);
      const text = readFileSync(join(MOD, name), 'utf8');
      expect(text, name).not.toMatch(/#[0-9A-Fa-f]{3,8}\b|\brgba?\(/u);
    }
    expect(Object.keys(INK)).toEqual(PALETTE.INK);
    expect(Object.keys(SIGNAL)).toEqual(PALETTE.SIGNAL);
    expect(Object.keys(STATUS_B)).toEqual(PALETTE.STATUS_B);
  });
});

const PALETTE = {
  INK: [
    'ink',
    'inkDark',
    'muted',
    'mutedDark',
    'mutedText',
    'headline',
    'headlineDark',
    'hairOpacity',
    'faintOpacity',
    'faintStrokeOpacity',
  ],
  SIGNAL: [
    'accent',
    'accentText',
    'accentTextDark',
    'attention',
    'caution',
    'cautionDark',
    'cautionText',
    'pass',
    'passDark',
    'passText',
    'fail',
    'failDark',
    'onSignal',
  ],
  STATUS_B: ['name', 'done', 'doneDark', 'failed', 'failedDark'],
};
