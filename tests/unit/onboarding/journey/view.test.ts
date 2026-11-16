import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emptyStages } from '../../../../src/onboarding/journey/run-store.js';
import type {
  JourneyEvent,
  JourneyRun,
  StageRecord,
} from '../../../../src/onboarding/journey/types.js';
import { buildView, writeView } from '../../../../src/onboarding/journey/view.js';

import { at, baseRun, clockAt, seedRun, tempRoot, unitRow } from './fixtures/journey.js';

const MODULES = Array.from({ length: 23 }, (_, i) => (i === 7 ? 'billing' : `m${i + 1}`));

function runWith(
  stages: Partial<Record<keyof JourneyRun['stages'], StageRecord>>,
  extra: Partial<JourneyRun> = {},
): JourneyRun {
  return { ...baseRun({ stages: { ...emptyStages(), ...stages }, ...extra }), revision: 5 };
}

const FIRST_THREE = {
  detect: { status: 'done' as const },
  setup: { status: 'done' as const },
  project_docs: { status: 'done' as const },
};

function modulesRunning(): JourneyRun {
  return runWith({
    ...FIRST_THREE,
    module_docs: { status: 'running', started_at: at(0), plan: MODULES },
  });
}

function sevenDone(): JourneyEvent[] {
  return MODULES.slice(0, 7).map((slug, i) => unitRow('module_docs', slug, at((i + 1) * 3)));
}

function allDone(degraded = false): JourneyRun['stages'] {
  const stages = emptyStages();
  for (const id of Object.keys(stages) as Array<keyof typeof stages>)
    stages[id] = { status: 'done' };
  if (degraded) stages.rules_discovery = { status: 'degraded', degraded: ['research_offline'] };
  return stages;
}

describe('journey view model', () => {
  it('AC-11: not started (the question state) shows row O6 with no button', () => {
    const view = buildView(null, [], { now: clockAt(0) });
    expect(view.status).toBe('not_started');
    expect(view.headline.row).toBe('O6');
    expect(view.workflow).toBe('Onboarding');
    expect(view.button).toBeNull();
  });

  it('AC-11: running with sub-progress shows "7 of 23 · billing" and the status line', () => {
    const view = buildView(modulesRunning(), sevenDone(), { now: clockAt(22) });
    expect(view.status).toBe('running');
    expect(view.headline).toEqual({
      row: 'O2',
      text: 'Step 4 of 8 · Writing the module docs · 7 of 23 · billing',
    });
    expect(view.status_line).toBe(
      '**▸ paqad** · Step 4 of 8 · Writing the module docs · 7 of 23 · billing',
    );
    expect(view.stages[3]?.sub_progress?.eta_minutes).toBe(48);
  });

  it('AC-13: alt text names each step with its state in words and the marks match', () => {
    const view = buildView(modulesRunning(), sevenDone(), { now: clockAt(22) });
    expect(view.alt).toBe(
      'Read done, Set up done, Docs done, Modules running 7 of 23, 4 not started',
    );
    expect(view.stages.map((stage) => stage.mark).join('')).toBe('✓✓✓▸○○○○');
  });

  it('AC-14: before a plan count exists there is no "N of M" and no ETA, and ETA waits for 3 units', () => {
    const noPlan = runWith({
      ...FIRST_THREE,
      module_docs: { status: 'running', started_at: at(0) },
    });
    const view = buildView(noPlan, [], { now: clockAt(1) });
    expect(view.headline.text).toBe('Step 4 of 8 · Writing the module docs');
    expect(view.stages[3]?.sub_progress?.eta_minutes).toBeNull();
    const twoDone = buildView(modulesRunning(), sevenDone().slice(0, 2), { now: clockAt(7) });
    expect(twoDone.stages[3]?.sub_progress?.words).toBe('2 of 23 · m3');
    expect(twoDone.stages[3]?.sub_progress?.eta_minutes).toBeNull();
  });

  it('AC-11: paused and stopped show row O1 with a Resume button', () => {
    const paused = buildView({ ...modulesRunning(), status: 'paused' }, [], { now: clockAt(1) });
    expect(paused.status).toBe('paused');
    expect(paused.button).toBe('Resume');
    const failedRun = runWith({
      ...FIRST_THREE,
      module_docs: { status: 'failed', started_at: at(0), failure: 'x' },
    });
    const stopped = buildView(failedRun, [], { now: clockAt(1) });
    expect(stopped.headline).toEqual({
      row: 'O1',
      text: 'Stopped at step 4 · Write the module docs · Resume to continue',
    });
    expect(stopped.button).toBe('Resume');
    const interrupted = buildView(modulesRunning(), sevenDone(), { now: clockAt(90) });
    expect(interrupted.status).toBe('stopped');
  });

  it('AC-11: between steps shows row O4', () => {
    const view = buildView(runWith(FIRST_THREE), [], { now: clockAt(1) });
    expect(view.headline).toEqual({ row: 'O4', text: 'Next: step 4 of 8 · Write the module docs' });
  });

  it('AC-11: after Wrap up the commit question shows row O3 and a Commit button', () => {
    const view = buildView(runWith(allDone()), [], { now: clockAt(1) });
    expect(view.headline.row).toBe('O3');
    expect(view.button).toBe('Commit');
    expect(view.celebrate).toBe(false);
  });

  it('AC-11: done celebrates only with no gaps', () => {
    const answered = {
      answer: 'branch' as const,
      answered_at: at(2),
      branch: 'chore/paqad-onboarding',
    };
    const done = buildView(runWith(allDone(), { commit: answered }), [], { now: clockAt(3) });
    expect(done.status).toBe('done');
    expect(done.celebrate).toBe(true);
  });

  it('FR-5: done with a gap shows its footnote and next action and never celebrates', () => {
    const answered = { answer: 'branch' as const, answered_at: at(2) };
    const view = buildView(runWith(allDone(true), { commit: answered }), [], { now: clockAt(3) });
    expect(view.status).toBe('done_with_gaps');
    expect(view.headline.text).toBe('Onboarding done with 1 gap');
    expect(view.celebrate).toBe(false);
    expect(view.gaps[0]?.code).toBe('research_offline');
    expect(view.gaps[0]?.next_action).toContain('rules discovery start');
    expect(view.alt).toContain('Research done with a gap');
  });

  it('AC-20: declining the commit ends Done with a note on how to commit later', () => {
    const declined = { answer: 'no' as const, answered_at: at(2) };
    const view = buildView(runWith(allDone(), { commit: declined }), [], { now: clockAt(3) });
    expect(view.status).toBe('done');
    expect(view.uncommitted_note).toContain('paqad-ai onboarding commit --branch');
  });

  it('NFR-7: shows planned counts and an hour range before research starts', () => {
    const run = runWith({
      ...FIRST_THREE,
      rules_discovery: { status: 'not_started', planned: 40 },
    });
    const view = buildView(run, [], { now: clockAt(1) });
    expect(view.planned.packages).toBe(40);
    expect(view.estimate).toMatch(/^about [1-5] to [1-5] hours$/u);
  });
});

describe('writeView', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC-4: writes nothing under .paqad/onboarding when no journey started', () => {
    writeView(root, { now: clockAt(0) });
    expect(existsSync(join(root, '.paqad/onboarding'))).toBe(false);
  });

  it('INV-22: writes view.json atomically and shows a refusal without changing stage state', () => {
    seedRun(root);
    const before = writeView(root, { now: clockAt(1) });
    const after = writeView(root, { now: clockAt(1), refusal: 'Step 4 cannot start' });
    const onDisk = JSON.parse(readFileSync(join(root, '.paqad/onboarding/view.json'), 'utf8'));
    expect(onDisk.refusal).toBe('Step 4 cannot start');
    expect(after.stages).toEqual(before.stages);
  });
});
