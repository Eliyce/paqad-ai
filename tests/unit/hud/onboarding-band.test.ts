import { describe, expect, it } from 'vitest';

import { emptyStages } from '@/onboarding/journey/run-store.js';
import type { JourneyRun } from '@/onboarding/journey/types.js';
import { buildView } from '@/onboarding/journey/view.js';
import { drawDesktopBand } from '../../../runtime/claude-plugin/mod/desktop-band.tsx';
import {
  COMMIT_PROMPT,
  RESUME_PROMPT,
  journeyBand,
  journeyBandShown,
  journeyPrompt,
  parseJourneyView,
} from '../../../runtime/claude-plugin/mod/journey-model.ts';

import { at, baseRun, clockAt } from '../onboarding/journey/fixtures/journey.js';

function view(stages: Partial<JourneyRun['stages']>, extra: Partial<JourneyRun> = {}) {
  const run = { ...baseRun({ stages: { ...emptyStages(), ...stages }, ...extra }), revision: 2 };
  return parseJourneyView(JSON.stringify(buildView(run, [], { now: clockAt(10) })))!;
}

function texts(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  const props = (node as { props?: Record<string, unknown> }).props ?? {};
  return [...(typeof props.alt === 'string' ? [`alt:${props.alt}`] : []), ...texts(props.children)];
}

(globalThis as { React?: unknown }).React = {
  createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({
    type,
    props: { ...(props ?? {}), children },
  }),
};

const ui = new Proxy({}, { get: (_target, name) => String(name) }) as never;
const noop = () => undefined;
const actions = {
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
  journey: noop,
};

describe('the drawn onboarding band', () => {
  it('AC-11 AC-13: draws the workflow word, the headline, the strip alt and Resume when stopped', () => {
    const stopped = view(
      { detect: { status: 'done' }, setup: { status: 'failed', started_at: at(1), failure: 'x' } },
      { status: 'failed' },
    );
    const band = {
      kind: 'onboarding' as const,
      model: journeyBand(stopped, { columns: 900, stalled: false }),
      columns: 900,
    };
    const drawn = texts(drawDesktopBand(ui, band, 0, actions)).join('\n');
    expect(drawn).toContain('Onboarding');
    expect(drawn).toContain('Stopped at step 2 · Set up paqad · Resume to continue');
    expect(drawn).toContain('alt:Read done, Set up stopped, 6 not started');
    expect(drawn).toContain('Resume');
  });

  it('AC-20: the finish screen keeps the uncommitted note and retires after 30 minutes', () => {
    const stages = emptyStages();
    for (const id of Object.keys(stages) as Array<keyof typeof stages>)
      stages[id] = { status: 'done' };
    const done = view(stages, { commit: { answer: 'later', answered_at: at(2) } });
    const band = {
      kind: 'onboarding' as const,
      model: journeyBand(done, { columns: 900, stalled: false }),
      columns: 900,
    };
    expect(texts(drawDesktopBand(ui, band, 0, actions)).join('\n')).toContain(
      'Your changes are uncommitted',
    );
    const generated = Date.parse(done.generated_at!);
    expect(journeyBandShown(done, generated + 60_000)).toBe(true);
    expect(journeyBandShown(done, generated + 31 * 60_000)).toBe(false);
    expect(journeyBandShown(null, generated)).toBe(false);
  });

  it('INV-2: Commit only submits a prompt asking the question; Resume asks to resume', () => {
    expect(journeyPrompt('Commit')).toBe(COMMIT_PROMPT);
    expect(COMMIT_PROMPT).not.toMatch(/--branch|--no|--later/u);
    expect(journeyPrompt('Resume')).toBe(RESUME_PROMPT);
  });
});
