import { describe, expect, it } from 'vitest';

import { DOCKED_LINE_MAX, buildStageRun, stagesWithAgentRows } from '@/hud/stage-run.js';
import { computeHudFlags, type HudStage } from '@/hud/snapshot.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';

const row = (fields: Record<string, unknown>): SessionLedgerRow =>
  ({ schema_version: 3, content_hash: 'h', ...fields }) as SessionLedgerRow;

const start = row({ kind: 'stage_start', stage: 'review' });
const injected = row({ kind: 'recipe-injected', stage: 'review', recipe: 'r', recipe_hash: 'h' });
const used = row({ kind: 'skill-used', stage: 'review' });
const started = (id = 'a1') =>
  row({ kind: 'stage-agent', stage: 'review', event_status: 'started', agent_id: id });
const completed = (fields: Record<string, unknown> = {}) =>
  row({
    kind: 'stage-agent',
    stage: 'review',
    event_status: 'completed',
    agent_id: 'a1',
    agent: 'paqad-review',
    report_status: 'DONE',
    report_stated: true,
    report_source: 'handback',
    api_turns: 44,
    tokens_used: 1000,
    ...fields,
  });

describe('a stage run line', () => {
  it('reads proven, the report and the turns', () => {
    const run = buildStageRun([start, injected, used, started(), completed()], 'review', 'full')!;
    expect(run.line).toBe('review · proven · DONE · 44 turns');
    expect(run.line.length).toBeLessThanOrEqual(DOCKED_LINE_MAX);
    expect(run.agent).toBe('paqad-review');
    expect(run.tokens_used).toBe(1000);
  });

  it('INV-6: does not read a script that could not check anything as proven', () => {
    const unchecked = row({ kind: 'skill-used', stage: 'review', unchecked: 'no test file' });
    const run = buildStageRun(
      [start, injected, unchecked, started(), completed()],
      'review',
      'full',
    );
    expect(run?.recipe).toBe('injected');
  });

  it('AC-45: reads the repaired status on a row the old parser could not read', () => {
    const line = buildStageRun(
      [
        {
          kind: 'stage-agent',
          stage: 'review',
          agent_id: 'a1',
          event_status: 'completed',
          report_status: 'BLOCKED',
          report_stated: false,
          report_source: 'none',
        },
        {
          kind: 'record-repair',
          reason: 'report read from handback after the parser fix',
          note: 'a1 review: DONE_WITH_CONCERNS (handback)',
        },
      ] as unknown as SessionLedgerRow[],
      'review',
      'full',
    );
    expect(line?.short_line).toContain('DONE_WITH_CONCERNS');
  });

  it('AC-69: reads injected when no skill-used row exists', () => {
    expect(buildStageRun([start, injected, completed()], 'review', 'full')?.recipe).toBe(
      'injected',
    );
  });

  it('keeps the turns on a long line by dropping the stage name to the heading', () => {
    const run = buildStageRun(
      [
        row({ kind: 'stage_start', stage: 'documentation_sync' }),
        row({ kind: 'recipe-injected', stage: 'documentation_sync' }),
        completed({
          stage: 'documentation_sync',
          report_status: 'DONE_WITH_CONCERNS',
          api_turns: 17,
        }),
      ],
      'documentation_sync',
      'full',
    )!;
    expect(run.line.length).toBeGreaterThan(DOCKED_LINE_MAX);
    expect(run.short_line).toBe('injected · DONE_WITH_CONCERNS · 17 turns');
    expect(run.short_line.length).toBeLessThanOrEqual(DOCKED_LINE_MAX);
  });

  it('AC-72: reads a running stage as not yet known and counting, even after a refused handback', () => {
    const denied = row({
      kind: 'stage-handback',
      stage: 'review',
      event_status: 'denied',
      report_status: 'DONE',
    });
    const run = buildStageRun([start, injected, started(), denied], 'review', 'full')!;
    expect(run.report).toBe('not yet known');
    expect(run.counting).toBe(true);
    expect(run.line).toContain('counting');
    expect(run.tone).toBe('dim');
  });

  it('AC-73: reads older rows as not recorded, and no report as no report found', () => {
    const old = row({
      schema_version: 2,
      kind: 'stage-agent',
      stage: 'review',
      event_status: 'completed',
      report_status: 'BLOCKED',
      report_stated: false,
    });
    const oldStart = row({ schema_version: 2, kind: 'stage_start', stage: 'review' });
    const legacy = buildStageRun([oldStart, old], 'review', 'full')!;
    expect(legacy).toMatchObject({ recipe: 'not recorded', report: 'not recorded', tone: 'dim' });
    const none = buildStageRun(
      [start, completed({ report_source: 'none', report_stated: false, report_status: 'BLOCKED' })],
      'review',
      'full',
    )!;
    expect(none).toMatchObject({ report: 'no report found', tone: 'dim', needs_look: false });
  });

  it('AC-74: draws nothing on a lane never meant to run a stage agent, or with nothing recorded', () => {
    const rows = [start, injected, completed()];
    expect(buildStageRun(rows, 'review', 'fast')).toBeNull();
    expect(buildStageRun(rows, 'review', 'graduated')).toBeNull();
    expect(buildStageRun([start], 'review', 'full')).toBeNull();
  });

  it('shows one line for several agents, summing turns, with the latest report', () => {
    const run = buildStageRun(
      [
        start,
        started('a1'),
        completed({ agent_id: 'a1', report_status: 'BLOCKED', api_turns: 10, reason: 'stuck' }),
        started('a2'),
        completed({ agent_id: 'a2', report_status: 'DONE', api_turns: 5 }),
      ],
      'review',
      'full',
    )!;
    expect(run).toMatchObject({ report: 'DONE', turns: 15, runs: 2, needs_look: false });
    expect(run.footnote).toBeNull();
  });

  it('carries the blocked reason, and the decision of a paused stage', () => {
    const blocked = buildStageRun(
      [start, completed({ report_status: 'BLOCKED', reason: 'refused 3 times: no artifact' })],
      'review',
      'full',
    )!;
    expect(blocked).toMatchObject({
      tone: 'fail',
      needs_look: true,
      footnote: 'refused 3 times: no artifact',
    });
    const paused = buildStageRun(
      [start, completed({ report_status: 'BLOCKED', decision: 'D-01ABC' })],
      'review',
      'full',
    )!;
    expect(paused.footnote).toBe('D-01ABC');
  });

  it('AC-75: colours BLOCKED red, the caution words amber and the plain words neutral', () => {
    const tone = (status: string) =>
      buildStageRun([start, completed({ report_status: status })], 'review', 'full')!.tone;
    expect(tone('BLOCKED')).toBe('fail');
    expect(tone('DONE_WITH_CONCERNS')).toBe('cau');
    expect(tone('NEEDS_CONTEXT')).toBe('cau');
    expect(tone('DONE')).toBe('dim');
    expect(
      buildStageRun([start, completed({ report_status: 'BLOCKED' })], 'review', 'full')!.line,
    ).toContain('BLOCKED');
  });
});

describe('the isolation flag per stage', () => {
  const stage = (name: string, state: string): HudStage =>
    ({ stage: name, state, mandatory: true, started_at: 'x' }) as unknown as HudStage;
  const flags = (stages: HudStage[], agents: string[]) =>
    computeHudFlags({
      stages,
      gates: [],
      rulesRecorded: true,
      tableSkipped: false,
      isolationStatus: 'expected',
      isolatedStages: agents.length,
      stageAgentsSeen: agents.length,
      stageAgentStages: agents,
    }).filter((flag) => flag.id === 'isolation-missing');

  it('AC-70: names the one stage that ended without its agent row', () => {
    const rows = [stage('planning', 'complete'), stage('development', 'complete')];
    expect(flags(rows, ['planning'])).toEqual([
      { id: 'isolation-missing', text: 'isolation missing: development' },
    ]);
  });

  it('AC-77: shares one row for several stages, under one flag id', () => {
    const rows = [
      stage('planning', 'complete'),
      stage('development', 'complete'),
      stage('review', 'complete'),
    ];
    expect(flags(rows, ['planning'])).toEqual([
      { id: 'isolation-missing', text: 'isolation missing: development, review' },
    ]);
  });

  it('AC-76: does not fire for a stage running or not yet reached', () => {
    const rows = [
      stage('planning', 'complete'),
      stage('review', 'running'),
      stage('checks', 'missing'),
    ];
    expect(flags(rows, ['planning'])).toEqual([]);
  });

  it('keeps the old words when no stage ran in its own agent', () => {
    expect(flags([stage('planning', 'complete')], [])[0]?.text).toBe(
      'No stage ran in its own agent on this lane.',
    );
  });

  it('collects stages from a row carrying several', () => {
    expect(
      stagesWithAgentRows([
        row({ kind: 'stage-agent', stage: 'planning', stages: ['planning', 'specification'] }),
      ]).sort(),
    ).toEqual(['planning', 'specification']);
  });
});
