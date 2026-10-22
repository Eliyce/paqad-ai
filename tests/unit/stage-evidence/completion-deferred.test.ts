import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openFeatureChange, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import {
  deferCompletionForBackgroundStage,
  hasOpenUnendedStage,
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
