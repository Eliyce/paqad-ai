import { describe, expect, it } from 'vitest';

import { buildView } from '@/onboarding/journey/view.js';
import { emptyStages } from '@/onboarding/journey/run-store.js';
import type { JourneyRun } from '@/onboarding/journey/types.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  isOnboardingCommand,
  journeyBand,
  parseJourneyView,
  rebindNeeded,
  skipsSubagentRow,
} from '../../../runtime/claude-plugin/mod/journey-model.ts';
import { decideStatus } from '../../../runtime/claude-plugin/mod/config.ts';

import { at, baseRun, clockAt, unitRow } from '../onboarding/journey/fixtures/journey.js';

const MODULES = Array.from({ length: 23 }, (_, i) => (i === 7 ? 'billing' : `m${i + 1}`));

function run(stages: Partial<JourneyRun['stages']>, extra: Partial<JourneyRun> = {}): JourneyRun {
  return { ...baseRun({ stages: { ...emptyStages(), ...stages }, ...extra }), revision: 2 };
}

const FIRST = {
  detect: { status: 'done' as const },
  setup: { status: 'done' as const },
  project_docs: { status: 'done' as const },
};

function band(view: ReturnType<typeof buildView>, columns = 900, stalled = false) {
  const parsed = parseJourneyView(JSON.stringify(view));
  if (!parsed) throw new Error('view did not parse');
  return journeyBand(parsed, { columns, stalled });
}

describe('the onboarding band model', () => {
  it('AC-11 AC-12: running with "7 of 23" sub-progress draws the word, the eight labels and the value', () => {
    const rows = MODULES.slice(0, 7).map((slug, i) =>
      unitRow('module_docs', slug, at((i + 1) * 3)),
    );
    const view = buildView(
      run({ ...FIRST, module_docs: { status: 'running', started_at: at(0), plan: MODULES } }),
      rows,
      {
        now: clockAt(22),
      },
    );
    const model = band(view);
    expect(model.word).toBe('Onboarding');
    expect(model.marks.map((mark) => mark.label)).toEqual([
      'Read',
      'Set up',
      'Docs',
      'Modules',
      'Research',
      'Triage',
      'Checks',
      'Wrap up',
    ]);
    expect(model.marks.map((mark) => mark.state)).toEqual([
      'done',
      'done',
      'done',
      'run',
      'todo',
      'todo',
      'todo',
      'todo',
    ]);
    expect(model.value).toBe('Modules · 7 of 23 · billing');
    expect(model.headline).toMatchObject({ row: 'O2', signal: 'accent' });
    expect(model.eta).toEqual({ eta: 'about 48 min left', etaInNote: false });
    expect(band(view, 600).eta.etaInNote).toBe(true);
    expect(skipsSubagentRow(parseJourneyView(JSON.stringify(view)))).toBe(true);
  });

  it('AC-13: the alt text names every step state in words', () => {
    const view = buildView(
      run({ ...FIRST, module_docs: { status: 'running', started_at: at(0), plan: MODULES } }),
      [],
      { now: clockAt(1) },
    );
    expect(band(view).alt).toBe(
      'Read done, Set up done, Docs done, Modules running 0 of 23, 4 not started',
    );
  });

  it('AC-11: stopped and paused show Resume, with the static stopped bar', () => {
    const stopped = band(
      buildView(
        run(
          { ...FIRST, module_docs: { status: 'failed', started_at: at(0) } },
          { status: 'failed' },
        ),
        [],
        { now: clockAt(1) },
      ),
    );
    expect(stopped.button).toBe('Resume');
    expect(stopped.marks[3]?.state).toBe('stopped');
    expect(stopped.value).toBe('Modules stopped');
    const paused = band(buildView(run(FIRST, { status: 'paused' }), [], { now: clockAt(1) }));
    expect(paused.headline.row).toBe('P');
    expect(paused.button).toBe('Resume');
  });

  it('AC-11: a stalled run shows row S with Resume', () => {
    const view = buildView(
      run({ ...FIRST, module_docs: { status: 'running', started_at: at(0) } }),
      [],
      { now: clockAt(1) },
    );
    const model = band(view, 900, true);
    expect(model.headline.row).toBe('S');
    expect(model.button).toBe('Resume');
  });

  it('AC-11: done with a gap draws the gap bar and never celebrates', () => {
    const stages = emptyStages();
    for (const id of Object.keys(stages) as Array<keyof typeof stages>)
      stages[id] = { status: 'done' };
    stages.rules_discovery = { status: 'degraded', degraded: ['research_offline'] };
    const model = band(
      buildView(run(stages, { commit: { answer: 'no', answered_at: at(2) } }), [], {
        now: clockAt(3),
      }),
    );
    expect(model.marks[4]?.state).toBe('gap');
    expect(model.celebrate).toBe(false);
    expect(model.value).toBe('All steps done');
    expect(model.note).toContain('uncommitted');
  });

  it('AC-11: the commit question shows the asking bar and the Commit button', () => {
    const stages = emptyStages();
    for (const id of Object.keys(stages) as Array<keyof typeof stages>)
      stages[id] = { status: 'done' };
    const model = band(buildView(run(stages), [], { now: clockAt(3) }));
    expect(model.button).toBe('Commit');
    expect(model.marks[7]?.state).toBe('paused');
    expect(model.headline.signal).toBe('attention');
  });

  it('the HUD stays up for a journey before setup finishes', () => {
    const base = {
      onboarded: false,
      env: {},
      localConfig: null,
      teamConfigs: [],
      engine: { version: '9.9.9' },
    };
    expect(decideStatus(base).reason).toBe('not-onboarded');
    expect(decideStatus({ ...base, journey: true }).on).toBe(true);
  });

  it('refuses a view that does not parse', () => {
    expect(parseJourneyView('{')).toBeNull();
    expect(parseJourneyView(null)).toBeNull();
  });
});

describe('AC-12 AC-3: the HUD binds to a journey before setup', () => {
  it('re-checks the root only after a Bash call that runs paqad-ai onboarding', () => {
    expect(
      isOnboardingCommand('Bash', { command: 'paqad-ai onboarding start --tools claude-code' }),
    ).toBe(true);
    expect(
      isOnboardingCommand('Bash', { command: 'SE_SESSION=x npx paqad-ai onboarding resume' }),
    ).toBe(true);
    expect(isOnboardingCommand('Bash', { command: 'paqad-ai onboard' })).toBe(true);
    expect(isOnboardingCommand('Bash', { command: 'paqad-ai status' })).toBe(false);
    expect(isOnboardingCommand('Read', { command: 'paqad-ai onboarding start' })).toBe(false);
    expect(isOnboardingCommand('Bash', {})).toBe(false);
  });

  it('rebinds when the same root turns on, off or moves, and not otherwise', () => {
    expect(rebindNeeded({ on: false, root: null }, { on: true, root: '/repo' })).toBe(true);
    expect(rebindNeeded({ on: true, root: '/repo' }, { on: false, root: null })).toBe(true);
    expect(rebindNeeded({ on: true, root: '/repo' }, { on: true, root: '/repo/' })).toBe(false);
    expect(rebindNeeded({ on: true, root: '/repo' }, { on: true, root: '/other' })).toBe(true);
    expect(rebindNeeded({ on: false, root: null }, { on: false, root: null })).toBe(false);
  });

  it('wires the re-check into the Bash call, the turn edges and the bind ticker', () => {
    const source = readFileSync(
      join(process.cwd(), 'runtime/claude-plugin/mod/register.tsx'),
      'utf8',
    );
    expect(source).toContain('if (isOnboardingCommand(tool, input)) await recheckRoot($);');
    expect(source).toContain('if (!live) await recheckRoot($);');
    expect(source).toContain('if (!live && !e.agentId) await recheckRoot($);');
    expect(source).toMatch(/bindWatch = \$\.clock\.every\(AGENT_TICK_MS[\s\S]*?recheckRoot\(\$\)/u);
    expect(source).toContain('await watchForJourney($);');
  });
});
