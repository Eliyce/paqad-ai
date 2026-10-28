import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { writeChecksRunningMarker } from '@/checks/running-marker.js';
import { featureChangeKey, featureFilePath } from '@/feature-evidence/paths.js';
import {
  appendFeatureStageRow,
  openFeatureChange,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import {
  deferCompletionForBackgroundStage,
  hasOpenUnendedStage,
  isBetweenStages,
  liveStageAgents,
  releaseStageAgentsAtSessionStart,
  stageAgentTaskCount,
  tasksCarryAgentType,
} from '@/stage-evidence/completion-deferred.js';
import { endStage, startStage } from '@/stage-evidence/recorder.js';

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-defer-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const SESSION = 'ses_defer';
const NOW = () => new Date('2026-10-17T10:00:00.000Z');

function openWithStartedStage(root: string): string {
  const dirName = openFeatureChange(root, SESSION, {
    adapter: 'claude-code',
    title: 'change under test',
    issue: null,
    now: NOW,
  });
  startStage(root, 'development', {
    sessionId: SESSION,
    dirName,
    adapter: 'claude-code',
    now: NOW,
  });
  return dirName;
}

function deferredRows(root: string, dirName: string) {
  return readFeatureStageUnit(root, dirName).filter((row) => row.kind === 'completion-deferred');
}

describe('stageAgentTaskCount', () => {
  it('counts tasks whose agent type starts with paqad-, across field name variants', () => {
    expect(
      stageAgentTaskCount([
        { type: 'paqad-development' },
        { agent_type: 'paqad-review' },
        { subagent_type: 'paqad-checks' },
        { agentType: 'paqad-planning' },
        { subagentType: 'paqad-specification' },
        { type: 'general-purpose' },
        { name: 'paqad-development' },
      ]),
    ).toBe(5);
  });

  it('is 0 for an empty list or entries with no agent type', () => {
    expect(stageAgentTaskCount([])).toBe(0);
    expect(stageAgentTaskCount([{ id: 'x' }, null, 'str'])).toBe(0);
  });
});

describe('tasksCarryAgentType', () => {
  it('is true when any entry carries a recognised agent-type field', () => {
    expect(tasksCarryAgentType([{ type: 'general-purpose' }])).toBe(true);
  });
  it('is false when no entry carries one', () => {
    expect(tasksCarryAgentType([{ id: 'x' }, {}])).toBe(false);
    expect(tasksCarryAgentType([])).toBe(false);
  });
});

describe('hasOpenUnendedStage', () => {
  it('is true while a started stage has no end, and false once it ends', () => {
    const root = tempRoot();
    const dirName = openWithStartedStage(root);
    expect(hasOpenUnendedStage(readFeatureStageUnit(root, dirName))).toBe(true);
    endStage(
      root,
      'development',
      {},
      { sessionId: SESSION, dirName, adapter: 'claude-code', now: NOW },
    );
    expect(hasOpenUnendedStage(readFeatureStageUnit(root, dirName))).toBe(false);
    startStage(root, 'development', {
      sessionId: SESSION,
      dirName,
      adapter: 'claude-code',
      now: NOW,
    });
    expect(hasOpenUnendedStage(readFeatureStageUnit(root, dirName))).toBe(true);
  });
});

describe('deferCompletionForBackgroundStage', () => {
  it('does not defer and writes no row for empty or missing background_tasks', () => {
    const root = tempRoot();
    const dirName = openWithStartedStage(root);
    expect(
      deferCompletionForBackgroundStage({
        projectRoot: root,
        backgroundTasks: [],
        sessionId: SESSION,
        adapter: 'claude-code',
        now: NOW,
      }),
    ).toEqual({ deferred: false });
    expect(
      deferCompletionForBackgroundStage({
        projectRoot: root,
        backgroundTasks: undefined,
        sessionId: SESSION,
        adapter: 'claude-code',
        now: NOW,
      }),
    ).toEqual({ deferred: false });
    expect(deferredRows(root, dirName)).toHaveLength(0);
  });

  it('defers and writes exactly one completion-deferred row for a running paqad stage agent', () => {
    const root = tempRoot();
    const dirName = openWithStartedStage(root);
    const result = deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [{ type: 'paqad-development' }, { type: 'general-purpose' }],
      sessionId: SESSION,
      adapter: 'claude-code',
      now: NOW,
    });
    expect(result).toEqual({
      deferred: true,
      reason: 'stage agent running in background',
      tasks: 1,
    });
    const rows = deferredRows(root, dirName);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: 'stage agent running in background', tasks: 1 });
  });

  it('does not defer for a non-paqad background task even while a stage is open', () => {
    const root = tempRoot();
    const dirName = openWithStartedStage(root);
    const result = deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [{ type: 'general-purpose' }],
      sessionId: SESSION,
      adapter: 'claude-code',
      now: NOW,
    });
    expect(result).toEqual({ deferred: false });
    expect(deferredRows(root, dirName)).toHaveLength(0);
  });

  it('falls back to deferring when a task carries no agent type and a stage is open', () => {
    const root = tempRoot();
    const dirName = openWithStartedStage(root);
    const result = deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [{ id: 'bg-1' }],
      sessionId: SESSION,
      adapter: 'claude-code',
      now: NOW,
    });
    expect(result).toEqual({
      deferred: true,
      reason: 'background task running while a stage is open',
      tasks: 1,
    });
    expect(deferredRows(root, dirName)).toHaveLength(1);
  });

  it('does not fall back when there is no open stage to protect', () => {
    const root = tempRoot();
    const result = deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [{ id: 'bg-1' }],
      sessionId: SESSION,
      adapter: 'claude-code',
      now: NOW,
    });
    expect(result).toEqual({ deferred: false });
  });

  it('does not fall back when a bundle exists but every stage has ended', () => {
    const root = tempRoot();
    const dirName = openWithStartedStage(root);
    endStage(
      root,
      'development',
      {},
      { sessionId: SESSION, dirName, adapter: 'claude-code', now: NOW },
    );
    const result = deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [{ id: 'bg-1' }],
      sessionId: SESSION,
      adapter: 'claude-code',
      now: NOW,
    });
    expect(result).toEqual({ deferred: false });
    expect(deferredRows(root, dirName)).toHaveLength(0);
  });

  it('defers for a running stage agent even with no active bundle, writing no row', () => {
    const root = tempRoot();
    const result = deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [{ type: 'paqad-development' }],
      sessionId: SESSION,
      adapter: 'claude-code',
      now: NOW,
    });
    expect(result).toEqual({
      deferred: true,
      reason: 'stage agent running in background',
      tasks: 1,
    });
  });

  it('resolves a session id when none is given (no active bundle)', () => {
    const root = tempRoot();
    const result = deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [{ type: 'paqad-development' }],
      adapter: 'claude-code',
      now: NOW,
    });
    expect(result.deferred).toBe(true);
  });
});
describe('deferCompletionForBackgroundStage with a checks run and a ceiling', () => {
  const MINUTE = 60_000;
  const minutesAfter = (minutes: number) => () => new Date(NOW().getTime() + minutes * MINUTE);
  const liveProbe = { isAlive: () => true, commandOf: () => 'node paqad-ai checks run' };

  function markChecksRunning(root: string, dirName: string | null, sessionId = SESSION): void {
    writeChecksRunningMarker(root, {
      pid: 4242,
      session_id: sessionId,
      change: dirName,
      started_at: NOW().toISOString(),
    });
  }

  it('AC-21: defers while this session holds a live checks run marker, with no background task', () => {
    const root = tempRoot();
    const dirName = openWithStartedStage(root);
    markChecksRunning(root, dirName);

    const result = deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [],
      sessionId: SESSION,
      adapter: 'claude-code',
      now: minutesAfter(5),
      probe: liveProbe,
    });

    expect(result).toEqual({ deferred: true, reason: 'checks run still running', tasks: 0 });
    expect(deferredRows(root, dirName)).toHaveLength(1);
  });

  it('AC-21: a live checks run marker defers even beside a typed non-paqad background task', () => {
    const root = tempRoot();
    const dirName = openWithStartedStage(root);
    markChecksRunning(root, dirName);

    const result = deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [{ type: 'general-purpose' }],
      sessionId: SESSION,
      adapter: 'claude-code',
      now: minutesAfter(5),
      probe: liveProbe,
    });

    expect(result).toEqual({ deferred: true, reason: 'checks run still running', tasks: 1 });
  });

  it('AC-21: a marker whose process is dead does not defer', () => {
    const root = tempRoot();
    const dirName = openWithStartedStage(root);
    markChecksRunning(root, dirName);

    const result = deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [],
      sessionId: SESSION,
      adapter: 'claude-code',
      now: minutesAfter(5),
      probe: { ...liveProbe, isAlive: () => false },
    });

    expect(result).toEqual({ deferred: false });
    expect(deferredRows(root, dirName)).toHaveLength(0);
  });

  it('AC-22: a live marker older than 30 minutes no longer defers', () => {
    const root = tempRoot();
    const dirName = openWithStartedStage(root);
    markChecksRunning(root, dirName);

    const result = deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [],
      sessionId: SESSION,
      adapter: 'claude-code',
      now: minutesAfter(31),
      probe: liveProbe,
    });

    expect(result).toEqual({ deferred: false });
  });

  it('another session’s marker does not defer this session', () => {
    const root = tempRoot();
    openWithStartedStage(root);
    markChecksRunning(root, null, 'ses_other');

    const result = deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [],
      sessionId: SESSION,
      adapter: 'claude-code',
      now: minutesAfter(5),
      probe: liveProbe,
    });

    expect(result).toEqual({ deferred: false });
  });

  function deferredStopAt(root: string, dirName: string, minutes: number): void {
    appendFeatureStageRow(
      root,
      SESSION,
      dirName,
      {
        kind: 'completion-deferred',
        reason: 'background task running while a stage is open',
        tasks: 1,
      },
      minutesAfter(minutes),
    );
  }

  it('INV-12: keeps deferring a background task within 30 minutes of the first deferred stop', () => {
    const root = tempRoot();
    const dirName = openWithStartedStage(root);
    writeWorkflowState(root, SESSION, {
      active: { workflow: 'feature-development', lane: 'full' },
      paused: [],
      turn_started_at: NOW().toISOString(),
    });
    deferredStopAt(root, dirName, 1);

    const result = deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [{ id: 'bg-1' }],
      sessionId: SESSION,
      adapter: 'claude-code',
      now: minutesAfter(30),
    });

    expect(result.deferred).toBe(true);
  });

  it('AC-39: a background task that never finishes stops deferring 30 minutes after the first deferred stop', () => {
    const root = tempRoot();
    const dirName = openWithStartedStage(root);
    writeWorkflowState(root, SESSION, {
      active: { workflow: 'feature-development', lane: 'full' },
      paused: [],
      turn_started_at: NOW().toISOString(),
    });
    deferredStopAt(root, dirName, 1);
    deferredStopAt(root, dirName, 20);

    const result = deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [{ type: 'paqad-development' }],
      sessionId: SESSION,
      adapter: 'claude-code',
      now: minutesAfter(32),
    });

    expect(result).toEqual({ deferred: false });
    expect(deferredRows(root, dirName)).toHaveLength(2);
  });

  it('INV-12: the 30 minute ceiling counts across turns from the first deferred stop', () => {
    const root = tempRoot();
    const dirName = openWithStartedStage(root);
    deferredStopAt(root, dirName, 1);
    deferredStopAt(root, dirName, 20);
    writeWorkflowState(root, SESSION, {
      active: { workflow: 'feature-development', lane: 'full' },
      paused: [],
      turn_started_at: minutesAfter(60)().toISOString(),
    });

    const result = deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [{ id: 'bg-1' }],
      sessionId: SESSION,
      adapter: 'claude-code',
      now: minutesAfter(61),
    });

    expect(result).toEqual({ deferred: false });
    expect(deferredRows(root, dirName)).toHaveLength(2);
  });

  it('INV-12: a judged stop starts a fresh 30 minute window', () => {
    const root = tempRoot();
    const dirName = openWithStartedStage(root);
    deferredStopAt(root, dirName, 1);
    appendFeatureStageRow(
      root,
      SESSION,
      dirName,
      { kind: 'verify', agent: 'backstop', event_status: 'failed', note: 'verdict=incomplete' },
      minutesAfter(40),
    );
    deferredStopAt(root, dirName, 50);

    const result = deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [{ id: 'bg-1' }],
      sessionId: SESSION,
      adapter: 'claude-code',
      now: minutesAfter(61),
    });

    expect(result.deferred).toBe(true);
  });

  it('INV-12: a deferred stop with an unreadable time does not hide the first readable one', () => {
    const root = tempRoot();
    const dirName = openWithStartedStage(root);
    appendFileSync(
      join(root, featureFilePath(dirName, 'stageEvidence')),
      `${JSON.stringify({
        doc_type: 'stage-evidence',
        session_id: SESSION,
        recorded_at: 'not-a-time',
        content_hash: 'unreadable',
        kind: 'completion-deferred',
      })}\n`,
    );
    deferredStopAt(root, dirName, 1);

    const result = deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [{ id: 'bg-1' }],
      sessionId: SESSION,
      adapter: 'claude-code',
      now: minutesAfter(61),
    });

    expect(result).toEqual({ deferred: false });
    expect(deferredRows(root, dirName)).toHaveLength(2);
  });
});

describe('reading a Claude Code Stop payload (hud-live-run-truth)', () => {
  it('a running subagent task with no agent type still defers while a stage is open', () => {
    const root = tempRoot();
    const dirName = openWithStartedStage(root);
    const result = deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [{ id: 'task-1', type: 'subagent', status: 'running' }],
      sessionId: SESSION,
      adapter: 'claude-code',
      now: NOW,
    });
    expect(result.deferred).toBe(true);
    expect(deferredRows(root, dirName)).toHaveLength(1);
  });

  it('a plugin-namespaced stage agent counts as a stage agent', () => {
    expect(stageAgentTaskCount([{ agent_type: 'paqad:paqad-planning', status: 'running' }])).toBe(
      1,
    );
  });

  it('a finished stage agent task alone does not defer', () => {
    const root = tempRoot();
    const dirName = openWithStartedStage(root);
    endStage(
      root,
      'development',
      {},
      { sessionId: SESSION, dirName, adapter: 'claude-code', now: NOW },
    );
    const result = deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [{ agent_type: 'paqad-planning', status: 'completed' }],
      sessionId: SESSION,
      adapter: 'claude-code',
      now: NOW,
    });
    expect(result).toEqual({ deferred: false });
  });
});

describe('liveStageAgents and the ledger branch (hud-live-run-truth)', () => {
  const MINUTE = 60_000;
  const at = (minutes: number) => () => new Date(NOW().getTime() + minutes * MINUTE);

  function agentRow(
    root: string,
    dirName: string,
    status: 'started' | 'completed',
    minutes: number,
    agentId: string | null = 'agent-plan-1',
  ): void {
    appendFeatureStageRow(
      root,
      SESSION,
      dirName,
      {
        kind: 'stage-agent',
        stage: 'planning',
        agent: 'paqad-planning',
        ...(agentId === null ? {} : { agent_id: agentId }),
        event_status: status,
        tokens_used: 0,
        tokens_not_recarried: 0,
        estimate: true,
      },
      at(minutes),
    );
  }

  it('lists a started agent with no stop and drops it once stopped; no clock decides', () => {
    const root = tempRoot();
    const dirName = openWithStartedStage(root);
    agentRow(root, dirName, 'started', 1);
    const rows = () => readFeatureStageUnit(root, dirName);
    expect(liveStageAgents(rows())).toEqual([
      expect.objectContaining({ stage: 'planning', agentId: 'agent-plan-1' }),
    ]);
    expect(
      deferCompletionForBackgroundStage({
        projectRoot: root,
        backgroundTasks: [],
        sessionId: SESSION,
        adapter: 'claude-code',
        now: at(90),
      }).deferred,
    ).toBe(true);
    agentRow(root, dirName, 'completed', 3);
    expect(liveStageAgents(rows())).toEqual([]);
  });

  it('FR-4: a payload that names its running agents and leaves ours out releases the deferral', () => {
    const root = tempRoot();
    const dirName = openWithStartedStage(root);
    endStage(
      root,
      'development',
      {},
      { sessionId: SESSION, dirName, adapter: 'claude-code', now: NOW },
    );
    agentRow(root, dirName, 'started', 1);
    expect(
      deferCompletionForBackgroundStage({
        projectRoot: root,
        backgroundTasks: [{ agent_type: 'general-purpose', status: 'running' }],
        sessionId: SESSION,
        adapter: 'claude-code',
        now: at(2),
      }),
    ).toEqual({ deferred: false });
  });

  it('matches by stage when the start carried no agent id', () => {
    const root = tempRoot();
    const dirName = openWithStartedStage(root);
    agentRow(root, dirName, 'started', 1, null);
    expect(liveStageAgents(readFeatureStageUnit(root, dirName))).toHaveLength(1);
    agentRow(root, dirName, 'completed', 3, null);
    expect(liveStageAgents(readFeatureStageUnit(root, dirName))).toHaveLength(0);
  });

  it.each([[[]], [undefined], ['not-a-list']])(
    'AC-2 / AC-28: background_tasks %j plus a live stage agent in the ledger defers with one row',
    (tasks) => {
      const root = tempRoot();
      const dirName = openWithStartedStage(root);
      agentRow(root, dirName, 'started', 1);
      const result = deferCompletionForBackgroundStage({
        projectRoot: root,
        backgroundTasks: tasks,
        sessionId: SESSION,
        adapter: 'claude-code',
        now: at(2),
      });
      expect(result).toEqual({
        deferred: true,
        reason: 'stage agent running in background',
        tasks: 1,
      });
      expect(deferredRows(root, dirName)).toHaveLength(1);
    },
  );

  it('AC-5: once the agent stops, the next turn end is judged again', () => {
    const root = tempRoot();
    const dirName = openWithStartedStage(root);
    agentRow(root, dirName, 'started', 1);
    agentRow(root, dirName, 'completed', 3);
    expect(
      deferCompletionForBackgroundStage({
        projectRoot: root,
        backgroundTasks: [],
        sessionId: SESSION,
        adapter: 'claude-code',
        now: at(4),
      }),
    ).toEqual({ deferred: false });
  });
});

describe('AC-3 / AC-4: a turn end between two stages (hud-live-run-truth)', () => {
  function openFull(root: string): string {
    return openFeatureChange(root, SESSION, {
      adapter: 'claude-code',
      title: 'between stages',
      issue: null,
      lane: 'full',
      now: NOW,
    });
  }

  function provenPlanning(root: string, dirName: string): void {
    startStage(root, 'planning', { sessionId: SESSION, dirName, adapter: 'claude-code', now: NOW });
    const plan = featureFilePath(dirName, 'plan');
    writeFileSync(join(root, plan), '{"steps":[{"id":"S1"}]}\n');
    endStage(
      root,
      'planning',
      { artifactPaths: [plan] },
      { sessionId: SESSION, dirName, adapter: 'claude-code', now: NOW },
    );
  }

  const stop = (root: string) =>
    deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [],
      sessionId: SESSION,
      adapter: 'claude-code',
      now: NOW,
    });

  it('AC-3: the last stage ended with its artifact and the next has not started: nothing is judged', () => {
    const root = tempRoot();
    const dirName = openFull(root);
    provenPlanning(root, dirName);
    expect(stop(root)).toMatchObject({
      deferred: true,
      reason: 'between stages',
      nextStage: 'specification',
    });
    expect(deferredRows(root, dirName)).toHaveLength(1);
  });

  it('AC-4: a stage that ended without its artifact is still judged', () => {
    const root = tempRoot();
    const dirName = openFull(root);
    startStage(root, 'planning', { sessionId: SESSION, dirName, adapter: 'claude-code', now: NOW });
    endStage(
      root,
      'planning',
      {},
      { sessionId: SESSION, dirName, adapter: 'claude-code', now: NOW },
    );
    expect(stop(root)).toEqual({ deferred: false });
  });

  it('AC-4: a stage left open with no stage agent running is still judged', () => {
    const root = tempRoot();
    const dirName = openFull(root);
    provenPlanning(root, dirName);
    startStage(root, 'specification', {
      sessionId: SESSION,
      dirName,
      adapter: 'claude-code',
      now: NOW,
    });
    expect(stop(root)).toEqual({ deferred: false });
  });
});

describe('releasing a stage agent that never reported back (D-01M5VMTDH7P9Y17CFH9NA2EMC1)', () => {
  const MINUTE = 60_000;
  const at = (minutes: number) => () => new Date(NOW().getTime() + minutes * MINUTE);

  function openFull(root: string): string {
    return openFeatureChange(root, SESSION, {
      adapter: 'claude-code',
      title: 'crashed stage agent',
      issue: null,
      lane: 'full',
      now: NOW,
    });
  }

  function started(root: string, dirName: string, stage: string, id: string, minutes: number) {
    appendFeatureStageRow(
      root,
      SESSION,
      dirName,
      {
        kind: 'stage-agent',
        stage,
        agent: `paqad-${stage}`,
        agent_id: id,
        event_status: 'started',
        tokens_used: 0,
        tokens_not_recarried: 0,
        estimate: true,
      },
      at(minutes),
    );
  }

  const live = (root: string, dirName: string) =>
    liveStageAgents(readFeatureStageUnit(root, dirName)).map((agent) => agent.agentId);

  const stop = (root: string, minutes: number) =>
    deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [],
      sessionId: SESSION,
      adapter: 'claude-code',
      now: at(minutes),
    });

  it('a stage_end of its stage releases a started agent with no stop', () => {
    const root = tempRoot();
    const dirName = openFull(root);
    startStage(root, 'planning', { sessionId: SESSION, dirName, adapter: 'claude-code', now: NOW });
    started(root, dirName, 'planning', 'a1', 1);
    expect(live(root, dirName)).toEqual(['a1']);
    endStage(
      root,
      'planning',
      {},
      { sessionId: SESSION, dirName, adapter: 'claude-code', now: at(2) },
    );
    expect(live(root, dirName)).toEqual([]);
  });

  it('a newer agent of the same stage releases the older one and stays live itself', () => {
    const root = tempRoot();
    const dirName = openFull(root);
    started(root, dirName, 'planning', 'a1', 1);
    started(root, dirName, 'planning', 'a2', 2);
    expect(live(root, dirName)).toEqual(['a2']);
  });

  it('a stage_start of a different stage releases it; one of the same stage does not', () => {
    const root = tempRoot();
    const dirName = openFull(root);
    started(root, dirName, 'planning', 'a1', 1);
    startStage(root, 'planning', {
      sessionId: SESSION,
      dirName,
      adapter: 'claude-code',
      now: at(2),
    });
    expect(live(root, dirName)).toEqual(['a1']);
    startStage(root, 'specification', {
      sessionId: SESSION,
      dirName,
      adapter: 'claude-code',
      now: at(3),
    });
    expect(live(root, dirName)).toEqual([]);
  });

  const startBy = (
    root: string,
    dirName: string,
    stage: string,
    minutes: number,
    agentId?: string,
  ) =>
    startStage(root, stage, {
      sessionId: SESSION,
      dirName,
      adapter: 'claude-code',
      now: at(minutes),
      ...(agentId === undefined ? {} : { agentId }),
    });

  const completed = (root: string, dirName: string, stage: string, id: string, minutes: number) =>
    appendFeatureStageRow(
      root,
      SESSION,
      dirName,
      {
        kind: 'stage-agent',
        stage,
        agent: `paqad-${stage}`,
        agent_id: id,
        event_status: 'completed',
        tokens_used: 10,
        tokens_not_recarried: 10,
        estimate: false,
      },
      at(minutes),
    );

  it('a stage_start of another stage stamped with the running agent id keeps its hold', () => {
    const root = tempRoot();
    const dirName = openFull(root);
    started(root, dirName, 'planning', 'a1', 1);
    startBy(root, dirName, 'specification', 2, 'a1');
    expect(live(root, dirName)).toEqual(['a1']);
    expect(
      readFeatureStageUnit(root, dirName).find(
        (row) => row.kind === 'stage_start' && row.stage === 'specification',
      )?.agent_id,
    ).toBe('a1');
  });

  it('a stage_start of another stage stamped with a different agent id keeps its hold: another stage agent wrote it', () => {
    const root = tempRoot();
    const dirName = openFull(root);
    started(root, dirName, 'planning', 'a1', 1);
    startBy(root, dirName, 'specification', 2, 'b2');
    expect(live(root, dirName)).toEqual(['a1']);
  });

  it('a stage_start with no or an empty agent id releases the hold as before', () => {
    const root = tempRoot();
    const dirName = openFull(root);
    started(root, dirName, 'planning', 'a1', 1);
    startBy(root, dirName, 'specification', 2, '');
    expect(
      readFeatureStageUnit(root, dirName).find((row) => row.kind === 'stage_start'),
    ).not.toHaveProperty('agent_id');
    expect(live(root, dirName)).toEqual([]);
    const base = { session_id: SESSION, recorded_at: NOW().toISOString() };
    const rows = [
      {
        ...base,
        kind: 'stage-agent',
        event_status: 'started',
        stage: 'planning',
        agent_id: 'a1',
        content_hash: 'h1',
      },
      { ...base, kind: 'stage_start', stage: 'specification', agent_id: '  ', content_hash: 'h2' },
    ] as unknown as SessionLedgerRow[];
    expect(liveStageAgents(rows)).toEqual([]);
  });

  it('a started row with no agent id is never the same agent, so it releases as before', () => {
    const base = { session_id: SESSION, recorded_at: NOW().toISOString() };
    const rows = [
      {
        ...base,
        kind: 'stage-agent',
        event_status: 'started',
        stage: 'planning',
        agent_id: 'a1',
        content_hash: 'h1',
      },
      {
        ...base,
        kind: 'stage-agent',
        event_status: 'started',
        stage: 'planning',
        agent_id: '',
        content_hash: 'h2',
      },
    ] as unknown as SessionLedgerRow[];
    expect(liveStageAgents(rows).map((agent) => agent.agentId)).toEqual([null]);
  });

  it('a second started row with the same agent id holds until its completed row', () => {
    const root = tempRoot();
    const dirName = openFull(root);
    started(root, dirName, 'development', 'd1', 1);
    completed(root, dirName, 'development', 'd1', 2);
    expect(live(root, dirName)).toEqual([]);
    started(root, dirName, 'development', 'd1', 3);
    expect(live(root, dirName)).toEqual(['d1']);
    expect(stop(root, 4).deferred).toBe(true);
    completed(root, dirName, 'development', 'd1', 5);
    expect(live(root, dirName)).toEqual([]);
  });

  it('a second started row with the same agent id holds until stage_end development', () => {
    const root = tempRoot();
    const dirName = openFull(root);
    startBy(root, dirName, 'development', 1);
    started(root, dirName, 'development', 'd1', 2);
    started(root, dirName, 'development', 'd1', 3);
    expect(new Set(live(root, dirName))).toEqual(new Set(['d1']));
    expect(stop(root, 4).deferred).toBe(true);
    endStage(
      root,
      'development',
      {},
      { sessionId: SESSION, dirName, adapter: 'claude-code', now: at(5) },
    );
    expect(live(root, dirName)).toEqual([]);
  });

  it('a resume that fires no SubagentStart keeps the hold through the open stage_start', () => {
    const root = tempRoot();
    const dirName = openFull(root);
    started(root, dirName, 'planning', 'p1', 1);
    startBy(root, dirName, 'planning', 2, 'p1');
    endStage(
      root,
      'planning',
      {},
      { sessionId: SESSION, dirName, adapter: 'claude-code', now: at(3) },
    );
    completed(root, dirName, 'planning', 'p1', 4);
    startBy(root, dirName, 'specification', 5, 'p1');
    const rows = readFeatureStageUnit(root, dirName);
    expect(liveStageAgents(rows)).toEqual([]);
    expect(hasOpenUnendedStage(rows)).toBe(true);
  });

  it('a new host session releases every started agent of the open change with one row', () => {
    const root = tempRoot();
    const dirName = openFull(root);
    started(root, dirName, 'planning', 'a1', 1);
    expect(releaseStageAgentsAtSessionStart(root, SESSION, 'compact', at(2))).toBe(false);
    expect(live(root, dirName)).toEqual(['a1']);
    expect(releaseStageAgentsAtSessionStart(root, SESSION, 'startup', at(3))).toBe(true);
    expect(live(root, dirName)).toEqual([]);
    expect(releaseStageAgentsAtSessionStart(root, SESSION, 'resume', at(4))).toBe(false);
    const repairs = readFeatureStageUnit(root, dirName).filter(
      (row) => row.kind === 'record-repair',
    );
    expect(repairs).toHaveLength(1);
    started(root, dirName, 'specification', 'a2', 5);
    expect(live(root, dirName)).toEqual(['a2']);
  });

  it('a second terminal keeps another live session agent; its own session or a gone host releases it', () => {
    const root = tempRoot();
    const dirName = openFull(root);
    const gonePid = spawnSync(process.execPath, ['-e', '']).pid!;
    const startedBy = (session: string, id: string, hostPid: number, minutes: number) =>
      appendFeatureStageRow(
        root,
        session,
        dirName,
        {
          kind: 'stage-agent',
          stage: 'planning',
          agent: 'paqad-planning',
          agent_id: id,
          event_status: 'started',
          host_pid: hostPid,
          tokens_used: 0,
          tokens_not_recarried: 0,
          estimate: true,
        },
        at(minutes),
      );
    startedBy(SESSION, 'a1', process.pid, 1);
    expect(releaseStageAgentsAtSessionStart(root, 'ses_other', 'startup', at(2))).toBe(false);
    expect(live(root, dirName)).toEqual(['a1']);
    expect(releaseStageAgentsAtSessionStart(root, SESSION, 'resume', at(3))).toBe(true);
    expect(live(root, dirName)).toEqual([]);

    startedBy(SESSION, 'a2', gonePid, 4);
    expect(releaseStageAgentsAtSessionStart(root, 'ses_other', 'startup', at(5))).toBe(true);
    expect(live(root, dirName)).toEqual([]);
  });

  it('AC-4: a stage open with a started agent that never stopped is judged after the release', () => {
    const root = tempRoot();
    const dirName = openFull(root);
    startStage(root, 'planning', { sessionId: SESSION, dirName, adapter: 'claude-code', now: NOW });
    started(root, dirName, 'planning', 'a1', 1);
    expect(stop(root, 60 * 24 * 30).deferred).toBe(true);
    releaseStageAgentsAtSessionStart(root, SESSION, 'resume', at(60 * 24 * 30));
    expect(stop(root, 60 * 24 * 30 + 1)).toEqual({ deferred: false });
  });

  it('an empty background_tasks list alone does not release it', () => {
    const root = tempRoot();
    const dirName = openFull(root);
    startStage(root, 'planning', { sessionId: SESSION, dirName, adapter: 'claude-code', now: NOW });
    started(root, dirName, 'planning', 'a1', 1);
    expect(stop(root, 2).deferred).toBe(true);
    expect(stop(root, 3).deferred).toBe(true);
    expect(live(root, dirName)).toEqual(['a1']);
  });
});

describe('review and documentation sync running side by side', () => {
  const MINUTE = 60_000;
  const at = (minutes: number) => () => new Date(NOW().getTime() + minutes * MINUTE);

  function openGraduated(root: string): string {
    return openFeatureChange(root, SESSION, {
      adapter: 'claude-code',
      title: 'parallel review and docs',
      issue: null,
      lane: 'graduated',
      now: NOW,
    });
  }

  function agentRow(
    root: string,
    dirName: string,
    stage: string,
    agent: string,
    id: string,
    status: 'started' | 'completed',
    minutes: number,
  ) {
    appendFeatureStageRow(
      root,
      SESSION,
      dirName,
      {
        kind: 'stage-agent',
        stage,
        agent,
        agent_id: id,
        event_status: status,
        tokens_used: 0,
        tokens_not_recarried: 0,
        estimate: true,
      },
      at(minutes),
    );
  }

  const ctx = (dirName: string, minutes: number) => ({
    sessionId: SESSION,
    dirName,
    adapter: 'claude-code',
    now: at(minutes),
  });

  const holds = (root: string, dirName: string) =>
    liveStageAgents(readFeatureStageUnit(root, dirName)).map(
      (agent) => `${agent.stage}:${agent.agentId}`,
    );

  it('AC-1: a hook-written docs-sync stage_start by paqad-documentation-sync keeps the review hold', () => {
    const root = tempRoot();
    const dirName = openGraduated(root);
    agentRow(root, dirName, 'review', 'paqad-review', 'r1', 'started', 1);
    startStage(root, 'documentation_sync', {
      ...ctx(dirName, 2),
      agent: 'paqad-documentation-sync',
      agentId: 'd1',
    });
    expect(holds(root, dirName)).toEqual(['review:r1']);
  });

  it('AC-1: the stage agent name alone, with no agent id, keeps the hold', () => {
    const root = tempRoot();
    const dirName = openGraduated(root);
    agentRow(root, dirName, 'review', 'paqad-review', 'r1', 'started', 1);
    startStage(root, 'documentation_sync', {
      ...ctx(dirName, 2),
      agent: 'paqad-documentation-sync',
    });
    expect(holds(root, dirName)).toEqual(['review:r1']);
  });

  it('AC-2: plugin-namespaced agent names keep the hold', () => {
    const root = tempRoot();
    const dirName = openGraduated(root);
    agentRow(root, dirName, 'review', 'paqad:paqad-review', 'r1', 'started', 1);
    startStage(root, 'documentation_sync', {
      ...ctx(dirName, 2),
      agent: 'paqad:paqad-documentation-sync',
    });
    expect(holds(root, dirName)).toEqual(['review:r1']);
  });

  it('AC-3: a CLI-written docs-sync stage_start (agent orchestrator, agent id d1) keeps the hold', () => {
    const root = tempRoot();
    const dirName = openGraduated(root);
    agentRow(root, dirName, 'review', 'paqad-review', 'r1', 'started', 1);
    startStage(root, 'documentation_sync', { ...ctx(dirName, 2), agentId: 'd1' });
    const start = readFeatureStageUnit(root, dirName).find((row) => row.kind === 'stage_start');
    expect(start?.agent).toBe('orchestrator');
    expect(holds(root, dirName)).toEqual(['review:r1']);
  });

  it.each([
    ['the orchestrator', 'orchestrator'],
    ['the backstop', 'backstop'],
  ])('AC-4: a stage_start of another stage by %s releases the hold', (_label, agent) => {
    const root = tempRoot();
    const dirName = openGraduated(root);
    agentRow(root, dirName, 'review', 'paqad-review', 'r1', 'started', 1);
    startStage(root, 'documentation_sync', { ...ctx(dirName, 2), agent });
    expect(holds(root, dirName)).toEqual([]);
  });

  it('AC-4: a stage_start of another stage with no agent and no agent id releases the hold', () => {
    const base = { session_id: SESSION, recorded_at: NOW().toISOString() };
    const rows = [
      {
        ...base,
        kind: 'stage-agent',
        event_status: 'started',
        stage: 'review',
        agent: 'paqad-review',
        agent_id: 'r1',
        content_hash: 'h1',
      },
      { ...base, kind: 'stage_start', stage: 'documentation_sync', content_hash: 'h2' },
    ] as unknown as SessionLedgerRow[];
    expect(liveStageAgents(rows)).toEqual([]);
  });

  it('AC-4: a non-stage paqad agent name does not count as a stage agent', () => {
    const root = tempRoot();
    const dirName = openGraduated(root);
    agentRow(root, dirName, 'review', 'paqad-review', 'r1', 'started', 1);
    startStage(root, 'documentation_sync', { ...ctx(dirName, 2), agent: 'paqad-expert' });
    expect(holds(root, dirName)).toEqual([]);
  });

  it('AC-5: a stage_start of another stage carrying the held agent id keeps the hold', () => {
    const root = tempRoot();
    const dirName = openGraduated(root);
    agentRow(root, dirName, 'review', 'paqad-review', 'r1', 'started', 1);
    startStage(root, 'documentation_sync', { ...ctx(dirName, 2), agentId: 'r1' });
    expect(holds(root, dirName)).toEqual(['review:r1']);
  });

  it('AC-6: the docs-sync stage_end releases only its own hold; review holds until its own end', () => {
    const root = tempRoot();
    const dirName = openGraduated(root);
    agentRow(root, dirName, 'review', 'paqad-review', 'r1', 'started', 1);
    startStage(root, 'review', { ...ctx(dirName, 2), agentId: 'r1' });
    agentRow(root, dirName, 'documentation_sync', 'paqad-documentation-sync', 'd1', 'started', 3);
    startStage(root, 'documentation_sync', { ...ctx(dirName, 4), agentId: 'd1' });
    expect(new Set(holds(root, dirName))).toEqual(new Set(['review:r1', 'documentation_sync:d1']));
    endStage(root, 'documentation_sync', {}, ctx(dirName, 5));
    expect(holds(root, dirName)).toEqual(['review:r1']);
    endStage(root, 'review', {}, ctx(dirName, 6));
    expect(holds(root, dirName)).toEqual([]);
  });

  it('AC-24: review’s completed stage-agent row releases its hold', () => {
    const root = tempRoot();
    const dirName = openGraduated(root);
    agentRow(root, dirName, 'review', 'paqad-review', 'r1', 'started', 1);
    startStage(root, 'documentation_sync', { ...ctx(dirName, 2), agentId: 'd1' });
    agentRow(root, dirName, 'review', 'paqad-review', 'r1', 'completed', 3);
    expect(holds(root, dirName)).toEqual([]);
  });

  it('AC-21: every interleaved row of the two stage agents is read back in order', () => {
    const root = tempRoot();
    const dirName = openGraduated(root);
    agentRow(root, dirName, 'review', 'paqad-review', 'r1', 'started', 1);
    agentRow(root, dirName, 'documentation_sync', 'paqad-documentation-sync', 'd1', 'started', 1);
    startStage(root, 'review', { ...ctx(dirName, 2), agentId: 'r1' });
    startStage(root, 'documentation_sync', { ...ctx(dirName, 2), agentId: 'd1' });
    endStage(root, 'documentation_sync', {}, ctx(dirName, 3));
    agentRow(root, dirName, 'documentation_sync', 'paqad-documentation-sync', 'd1', 'completed', 3);
    endStage(root, 'review', {}, ctx(dirName, 4));
    agentRow(root, dirName, 'review', 'paqad-review', 'r1', 'completed', 4);
    const rows = readFeatureStageUnit(root, dirName)
      .filter((row) => row.stage === 'review' || row.stage === 'documentation_sync')
      .map((row) => `${row.kind}:${row.stage}:${String(row.event_status ?? '')}`);
    expect(rows).toEqual([
      'stage-agent:review:started',
      'stage-agent:documentation_sync:started',
      'stage_start:review:started',
      'stage_start:documentation_sync:started',
      'stage_end:documentation_sync:completed',
      'stage-agent:documentation_sync:completed',
      'stage_end:review:completed',
      'stage-agent:review:completed',
    ]);
  });
});

describe('a deferral asked without recording (capability gate)', () => {
  it('answers the same and writes no completion-deferred row', () => {
    const root = tempRoot();
    const dirName = openWithStartedStage(root);
    const result = deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [{ type: 'paqad-development' }],
      sessionId: SESSION,
      adapter: 'claude-code',
      now: NOW,
      record: false,
    });
    expect(result).toMatchObject({ deferred: true, reason: 'stage agent running in background' });
    expect(deferredRows(root, dirName)).toHaveLength(0);
  });
});

describe('every deferral release path', () => {
  function openFull(root: string): string {
    return openFeatureChange(root, SESSION, {
      adapter: 'claude-code',
      title: 'release paths',
      issue: null,
      lane: 'full',
      now: NOW,
    });
  }

  function provenPlanning(root: string, dirName: string): void {
    startStage(root, 'planning', { sessionId: SESSION, dirName, adapter: 'claude-code', now: NOW });
    const plan = featureFilePath(dirName, 'plan');
    writeFileSync(join(root, plan), '{"steps":[{"id":"S1"}]}\n');
    endStage(
      root,
      'planning',
      { artifactPaths: [plan] },
      { sessionId: SESSION, dirName, adapter: 'claude-code', now: NOW },
    );
  }

  function writeDecision(root: string, folder: 'pending' | 'resolved', id: string, change: string) {
    const dir = join(root, '.paqad', 'decisions', folder);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({ id, change }));
  }

  const stop = (root: string) =>
    deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [],
      sessionId: SESSION,
      adapter: 'claude-code',
      now: NOW,
    });

  it('a started agent row with no stage or no readable time is not live', () => {
    const base = {
      kind: 'stage-agent',
      event_status: 'started',
      session_id: SESSION,
      content_hash: 'h',
    };
    const rows = [
      { ...base, stage: '  ', recorded_at: NOW().toISOString() },
      { ...base, stage: 'planning' },
      { ...base, stage: 'planning', recorded_at: 'not a time' },
    ] as unknown as SessionLedgerRow[];
    expect(liveStageAgents(rows)).toEqual([]);
  });

  it('a new host session with no open change releases nothing', () => {
    const root = tempRoot();
    expect(releaseStageAgentsAtSessionStart(root, SESSION, 'startup', NOW)).toBe(false);
  });

  it('a closed change is never between stages', () => {
    const root = tempRoot();
    const dirName = openFull(root);
    provenPlanning(root, dirName);
    expect(isBetweenStages(root, SESSION, dirName)).toBe(true);
    appendFeatureStageRow(root, SESSION, dirName, { kind: 'close' }, NOW);
    expect(isBetweenStages(root, SESSION, dirName)).toBe(false);
  });

  it('a pending decision of this change withholds the next stage; others do not', () => {
    const root = tempRoot();
    const dirName = openFull(root);
    provenPlanning(root, dirName);
    const key = featureChangeKey(dirName);
    writeDecision(root, 'resolved', 'D-1', key);
    writeDecision(root, 'pending', 'D-2', 'another-change');
    expect(stop(root)).toMatchObject({ reason: 'between stages', nextStage: 'specification' });
    writeDecision(root, 'pending', 'D-3', key);
    const paused = stop(root);
    expect(paused).toMatchObject({ deferred: true, reason: 'between stages' });
    expect(paused.nextStage).toBeUndefined();
  });

  it('reads the wall clock when no clock is given', () => {
    const root = tempRoot();
    const dirName = openWithStartedStage(root);
    const result = deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: [{ type: 'paqad-development' }],
      sessionId: SESSION,
      adapter: 'claude-code',
    });
    expect(result).toMatchObject({ deferred: true, reason: 'stage agent running in background' });
    expect(deferredRows(root, dirName)).toHaveLength(1);
  });
});
