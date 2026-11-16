import { describe, expect, it } from 'vitest';

import { foldJourney, foldStage } from '../../../../src/onboarding/journey/fold.js';
import { emptyStages } from '../../../../src/onboarding/journey/run-store.js';
import type { JourneyEvent, JourneyRun } from '../../../../src/onboarding/journey/types.js';

import { T0, at, baseRun, clockAt, unitRow } from './fixtures/journey.js';

const MODULES = Array.from({ length: 23 }, (_, i) => `m${String(i + 1).padStart(2, '0')}`);

function runAtModules(status: 'running' | 'failed' = 'running'): JourneyRun {
  const stages = emptyStages();
  for (const id of ['detect', 'setup', 'project_docs'] as const) stages[id] = { status: 'done' };
  stages.module_docs = { status, started_at: at(1), plan: MODULES };
  return { ...baseRun({ stages }), revision: 3 };
}

function modulesDone(count: number, start = 2): JourneyEvent[] {
  return MODULES.slice(0, count).map((slug, i) => unitRow('module_docs', slug, at(start + i)));
}

describe('journey fold', () => {
  it('AC-7: with 7 of 23 modules logged, module 8 is first to do and 1 to 7 are not redone', () => {
    const fold = foldStage(runAtModules(), modulesDone(7), 'module_docs');
    expect(fold.done).toBe(7);
    expect(fold.total).toBe(23);
    expect(fold.units_todo[0]).toBe('m08');
    expect(fold.units_todo).not.toContain('m01');
    expect(fold.units_todo).toHaveLength(16);
    expect(fold.last_unit).toBe('m07');
  });

  it('AC-7: at 0 units done the first unit is first to do', () => {
    const fold = foldStage(runAtModules(), [], 'module_docs');
    expect(fold.units_todo[0]).toBe('m01');
    expect(fold.done).toBe(0);
  });

  it('AC-7: with every unit done and the step not closed nothing is left to redo', () => {
    const fold = foldStage(runAtModules(), modulesDone(23), 'module_docs');
    expect(fold.units_todo).toEqual([]);
    expect(fold.done).toBe(23);
  });

  it('AC-7: a failure on the last unit leaves only that unit to do', () => {
    const fold = foldStage(runAtModules('failed'), modulesDone(22), 'module_docs');
    expect(fold.units_todo).toEqual(['m23']);
  });

  it('AC-2: rows older than the stage start or from another run never count', () => {
    const rows = [
      unitRow('module_docs', 'm01', T0),
      { ...unitRow('module_docs', 'm02', at(3)), run_id: 'old-run' },
      unitRow('module_docs', 'm03', at(3)),
    ];
    const fold = foldStage(runAtModules(), rows, 'module_docs');
    expect(fold.units_done).toEqual(['m03']);
    expect(fold.units_todo[0]).toBe('m01');
  });

  it('FR-26: a module whose source hash changed is counted as not done', () => {
    const rows = [
      unitRow('module_docs', 'm01', at(2), { source_hash: 'h1' }),
      unitRow('module_docs', 'm02', at(3), { source_hash: 'h2' }),
    ];
    const fold = foldStage(runAtModules(), rows, 'module_docs', {
      currentSourceHashes: { m01: 'h1', m02: 'changed' },
    });
    expect(fold.units_done).toEqual(['m01']);
  });

  it('uses the latest progress row for stages that count in batches', () => {
    const run = runAtModules();
    run.stages.rules_analyze = { status: 'running', started_at: at(1) };
    const rows: JourneyEvent[] = [
      {
        ts: at(2),
        run_id: 'run-1',
        kind: 'progress',
        stage: 'rules_analyze',
        done: 25,
        total: 261,
      },
      {
        ts: at(3),
        run_id: 'run-1',
        kind: 'progress',
        stage: 'rules_analyze',
        done: 125,
        total: 261,
      },
    ];
    const fold = foldStage(run, rows, 'rules_analyze');
    expect(fold.done).toBe(125);
    expect(fold.total).toBe(261);
  });

  it('derives interrupted after 20 minutes of silence with no open agent', () => {
    const run = runAtModules();
    const rows = modulesDone(7);
    expect(foldJourney(run, rows, { now: clockAt(15) }).interrupted).toBe(false);
    expect(foldJourney(run, rows, { now: clockAt(40) }).interrupted).toBe(true);
    const withAgent = [
      ...rows,
      {
        ts: at(9),
        run_id: 'run-1',
        kind: 'agent_start' as const,
        agent: 'paqad-onboarding-modules',
      },
    ];
    expect(foldJourney(run, withAgent, { now: clockAt(40) }).interrupted).toBe(false);
    expect(foldJourney(run, withAgent, { now: clockAt(40) }).open_agents).toEqual([
      'paqad-onboarding-modules',
    ]);
  });

  it('names the current stage as the running or failed one, else the first not started', () => {
    expect(foldJourney(runAtModules(), [], { now: clockAt(1) }).current).toBe('module_docs');
    const fresh = { ...baseRun(), revision: 1 } as JourneyRun;
    expect(foldJourney(fresh, [], { now: clockAt(1) }).current).toBe('detect');
  });
});
