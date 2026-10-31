import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { featureFilePath } from '@/feature-evidence/paths.js';
import {
  appendFeatureStageRow,
  closeActiveFeature,
  openFeatureChange,
  resumeFeatureByRef,
} from '@/feature-evidence/stage-ledger.js';
import {
  classifyCompletionEnforcement,
  editedDevelopmentThisTurn,
  sessionOwnedRows,
} from '@/pipeline/session-ownership.js';
import { writeWorkflowState, type WorkflowState } from '@/pipeline/workflow-state.js';
import { endStage, startStage } from '@/stage-evidence/recorder.js';

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-session-ownership-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const A = 'ses_owner_a';
const B = 'ses_other_b';
const TURN = '2026-03-01T10:00:00.000Z';
const BEFORE = () => new Date('2026-03-01T09:00:00.000Z');
const AFTER = () => new Date('2026-03-01T10:05:00.000Z');

function ownChange(root: string, session: string, now: () => Date = BEFORE): string {
  const dirName = openFeatureChange(root, session, {
    adapter: 'claude-code',
    title: `change by ${session}`,
    issue: null,
    now,
  });
  startStage(root, 'development', { sessionId: session, dirName, adapter: 'claude-code', now });
  return dirName;
}

function route(root: string, session: string, state: WorkflowState): void {
  writeWorkflowState(root, session, state);
}

describe('sessionOwnedRows', () => {
  it('returns only this session’s agent-authored rows from unclosed bundles', () => {
    const root = tempRoot();
    const dirA = ownChange(root, A);
    endStage(root, 'development', {}, { sessionId: A, dirName: dirA, adapter: 'claude-code' });
    ownChange(root, B);

    const rows = sessionOwnedRows(root, A);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.session_id === A)).toBe(true);
  });

  it('does not count another session’s rows', () => {
    const root = tempRoot();
    ownChange(root, A);
    expect(sessionOwnedRows(root, B)).toEqual([]);
  });

  it('does not count inferred-git or inferred-artifact rows', () => {
    const root = tempRoot();
    const dirName = openFeatureChange(root, A, { adapter: 'backstop', title: 'x', issue: null });
    for (const source of ['inferred-git', 'inferred-artifact']) {
      appendFeatureStageRow(root, A, dirName, {
        kind: 'stage_start',
        stage: 'development',
        event_status: 'inferred',
        evidence_source: source,
      });
    }
    expect(sessionOwnedRows(root, A)).toEqual([]);
  });

  it('counts redo rows as ownership', () => {
    const root = tempRoot();
    const dirName = openFeatureChange(root, A, { adapter: 'claude-code', title: 'x', issue: null });
    appendFeatureStageRow(root, A, dirName, {
      kind: 'stage_start',
      stage: 'development',
      event_status: 'redone',
      evidence_source: 'redo',
    });
    expect(sessionOwnedRows(root, A)).toHaveLength(1);
  });

  it('does not count rows in a closed bundle', () => {
    const root = tempRoot();
    ownChange(root, A);
    closeActiveFeature(root, A);
    expect(sessionOwnedRows(root, A)).toEqual([]);
  });

  it('reads an unreadable bundle as no rows', () => {
    const root = tempRoot();
    const dirName = 'change-01M3AHBP2JKQS0K42Q51QGY1ZZ';
    mkdirSync(join(root, featureFilePath(dirName, 'stageEvidence')), { recursive: true });
    expect(sessionOwnedRows(root, A)).toEqual([]);
    expect(classifyCompletionEnforcement(root, A)).toMatchObject({
      enforce: false,
      reason: 'not-owner',
    });
  });
});

describe('classifyCompletionEnforcement', () => {
  it.each<WorkflowState>([
    { active: { workflow: 'feature-development', lane: 'full' }, paused: [] },
    { active: { workflow: 'project-question' }, paused: [] },
    { active: null, paused: [] },
  ])('skips a session that owns nothing, whatever the route (%j)', (state) => {
    const root = tempRoot();
    ownChange(root, A);
    route(root, B, { ...state, turn_started_at: TURN });
    expect(classifyCompletionEnforcement(root, B)).toMatchObject({
      enforce: false,
      reason: 'not-owner',
    });
  });

  it('names the active workflow on a not-owner skip', () => {
    const root = tempRoot();
    route(root, B, { active: { workflow: 'project-question' }, paused: [] });
    expect(classifyCompletionEnforcement(root, B)).toEqual({
      enforce: false,
      reason: 'not-owner',
      activeWorkflow: 'project-question',
    });
  });

  it('enforces an owner that wrote a row this turn, even under a non-feature route', () => {
    const root = tempRoot();
    ownChange(root, A, AFTER);
    route(root, A, {
      active: { workflow: 'project-question' },
      paused: [],
      turn_started_at: TURN,
    });
    expect(classifyCompletionEnforcement(root, A)).toMatchObject({
      enforce: true,
      reason: 'edited-this-turn',
    });
  });

  it('enforces an owner that reopened a closed change and edited it this turn, under a documentation-update route', () => {
    const root = tempRoot();
    const dirName = ownChange(root, A);
    closeActiveFeature(root, A, BEFORE);
    expect(resumeFeatureByRef(root, A, dirName, AFTER)).toBe(dirName);
    startStage(root, 'development', { sessionId: A, dirName, adapter: 'claude-code', now: AFTER });
    route(root, A, {
      active: { workflow: 'documentation-update' },
      paused: [],
      turn_started_at: TURN,
    });
    expect(sessionOwnedRows(root, A).length).toBeGreaterThan(0);
    expect(classifyCompletionEnforcement(root, A)).toMatchObject({
      enforce: true,
      reason: 'edited-this-turn',
      activeWorkflow: 'documentation-update',
    });
  });

  it('does not let another session own a reopened change', () => {
    const root = tempRoot();
    const dirName = ownChange(root, A);
    closeActiveFeature(root, A, BEFORE);
    resumeFeatureByRef(root, A, dirName, AFTER);
    startStage(root, 'development', { sessionId: A, dirName, adapter: 'claude-code', now: AFTER });
    expect(sessionOwnedRows(root, B)).toEqual([]);
  });

  it('skips an owner whose reopened change was closed again', () => {
    const root = tempRoot();
    const dirName = ownChange(root, A);
    closeActiveFeature(root, A, BEFORE);
    resumeFeatureByRef(root, A, dirName, AFTER);
    startStage(root, 'development', { sessionId: A, dirName, adapter: 'claude-code', now: AFTER });
    closeActiveFeature(root, A, AFTER);
    route(root, A, { active: null, paused: [], turn_started_at: TURN });
    expect(classifyCompletionEnforcement(root, A)).toMatchObject({
      enforce: false,
      reason: 'not-owner',
    });
  });

  it('counts a row stamped exactly at the turn start as this turn', () => {
    const root = tempRoot();
    ownChange(root, A, () => new Date(TURN));
    route(root, A, { active: { workflow: 'no-workflow' }, paused: [], turn_started_at: TURN });
    expect(classifyCompletionEnforcement(root, A).reason).toBe('edited-this-turn');
  });

  it('enforces an owner on a feature-development turn with no edit this turn', () => {
    const root = tempRoot();
    ownChange(root, A);
    route(root, A, {
      active: { workflow: 'feature-development', lane: 'full' },
      paused: [],
      turn_started_at: TURN,
    });
    expect(classifyCompletionEnforcement(root, A)).toMatchObject({
      enforce: true,
      reason: 'owner-feature-dev',
    });
  });

  it('enforces an owner whose route was never recorded', () => {
    const root = tempRoot();
    ownChange(root, A);
    route(root, A, { active: null, paused: [], turn_started_at: TURN });
    expect(classifyCompletionEnforcement(root, A)).toEqual({
      enforce: true,
      reason: 'owner-unknown-route',
      activeWorkflow: null,
    });
  });

  it('skips an owner on a detour: non-feature active, feature-development paused, no edit', () => {
    const root = tempRoot();
    ownChange(root, A);
    route(root, A, {
      active: { workflow: 'project-question' },
      paused: [{ workflow: 'feature-development', lane: 'full' }],
      turn_started_at: TURN,
    });
    expect(classifyCompletionEnforcement(root, A)).toEqual({
      enforce: false,
      reason: 'detour',
      activeWorkflow: 'project-question',
    });
  });

  it('AC-14: a state file without turn_started_at parses and an owner enforces', () => {
    const root = tempRoot();
    ownChange(root, A);
    route(root, A, { active: { workflow: 'project-question' }, paused: [] });
    expect(classifyCompletionEnforcement(root, A)).toMatchObject({
      enforce: true,
      reason: 'edited-this-turn',
    });
  });

  it('treats an unparseable turn stamp like no stamp', () => {
    const root = tempRoot();
    ownChange(root, A);
    route(root, A, {
      active: { workflow: 'project-question' },
      paused: [],
      turn_started_at: 'not a date',
    });
    expect(classifyCompletionEnforcement(root, A).enforce).toBe(true);
  });

  it('ignores an owned row whose ts cannot be parsed when judging this turn', () => {
    const root = tempRoot();
    const dirName = openFeatureChange(root, A, { adapter: 'claude-code', title: 'x', issue: null });
    appendFileSync(
      join(root, featureFilePath(dirName, 'stageEvidence')),
      `${JSON.stringify({
        schema_version: 1,
        doc_type: 'paqad.stage-evidence',
        session_id: A,
        ts: 'garbage',
        content_hash: 'x',
        kind: 'stage_start',
        evidence_source: 'live-mark',
      })}\n`,
    );
    route(root, A, { active: { workflow: 'project-question' }, paused: [], turn_started_at: TURN });
    expect(classifyCompletionEnforcement(root, A).reason).toBe('detour');
  });

  it('judges a new row by recorded_at, and one with an empty time as no time', () => {
    const root = tempRoot();
    const dirName = openFeatureChange(root, A, { adapter: 'claude-code', title: 'x', issue: null });
    const row = (recorded_at: string) =>
      `${JSON.stringify({
        schema_version: 2,
        doc_type: 'paqad.stage-evidence',
        change: dirName.slice(-26),
        session_id: A,
        recorded_at,
        content_hash: 'x',
        kind: 'stage_start',
        evidence_source: 'live-mark',
      })}\n`;
    const ledger = join(root, featureFilePath(dirName, 'stageEvidence'));
    appendFileSync(ledger, row(''));
    route(root, A, { active: { workflow: 'project-question' }, paused: [], turn_started_at: TURN });
    expect(classifyCompletionEnforcement(root, A).reason).toBe('detour');
    appendFileSync(ledger, row(AFTER().toISOString()));
    expect(classifyCompletionEnforcement(root, A).reason).toBe('edited-this-turn');
  });

  it('resolves the session from the cache when no id is passed', () => {
    const root = tempRoot();
    ownChange(root, A);
    route(root, A, { active: null, paused: [], turn_started_at: TURN });
    classifyCompletionEnforcement(root, A);
    expect(classifyCompletionEnforcement(root, null).reason).toBe('owner-unknown-route');
  });
});

describe('editedDevelopmentThisTurn', () => {
  it('is true for this session’s development row written this turn', () => {
    const root = tempRoot();
    ownChange(root, A, AFTER);
    route(root, A, { active: null, paused: [], turn_started_at: TURN });
    expect(editedDevelopmentThisTurn(root, A)).toBe(true);
  });

  it('ignores another session’s edits and rows from before the turn', () => {
    const root = tempRoot();
    ownChange(root, B, AFTER);
    ownChange(root, A, BEFORE);
    route(root, A, { active: null, paused: [], turn_started_at: TURN });
    expect(editedDevelopmentThisTurn(root, A)).toBe(false);
  });

  it('ignores a non-development row written this turn', () => {
    const root = tempRoot();
    const dirName = openFeatureChange(root, A, { adapter: 'claude-code', title: 'x', issue: null });
    startStage(root, 'checks', { sessionId: A, dirName, adapter: 'claude-code', now: AFTER });
    route(root, A, { active: null, paused: [], turn_started_at: TURN });
    expect(editedDevelopmentThisTurn(root, A)).toBe(false);
  });

  it('counts any owned development row when the turn was never stamped', () => {
    const root = tempRoot();
    ownChange(root, A, BEFORE);
    expect(editedDevelopmentThisTurn(root, A)).toBe(true);
  });
});

describe('stage-agent work counts as the orchestrator session’s own', () => {
  const SUB = 'ses_stage_subagent';
  const DETOUR: WorkflowState = {
    active: { workflow: 'project-question' },
    paused: [{ workflow: 'feature-development', lane: 'full' }],
    turn_started_at: TURN,
  };

  function agentDevelopmentRow(
    root: string,
    dirName: string,
    now: () => Date,
    session: string = SUB,
  ): void {
    appendFeatureStageRow(
      root,
      session,
      dirName,
      {
        kind: 'stage_start',
        stage: 'development',
        event_status: 'started',
        evidence_source: 'live-mark',
        agent: 'paqad-development',
      },
      now,
    );
  }

  function stageAgentRow(root: string, session: string, dirName: string, now: () => Date): void {
    appendFeatureStageRow(
      root,
      session,
      dirName,
      {
        kind: 'stage-agent',
        stage: 'development',
        agent: 'paqad-development',
        tokens_used: 10,
        tokens_not_recarried: 10,
        estimate: true,
      },
      now,
    );
  }

  it('AC-10: an orchestrator whose own rows are only stage markers is enforced when its agent edited this turn', () => {
    const root = tempRoot();
    const dirO = ownChange(root, A, BEFORE);
    agentDevelopmentRow(root, dirO, AFTER, A);
    route(root, A, DETOUR);

    expect(sessionOwnedRows(root, A).some((row) => row.agent === 'paqad-development')).toBe(true);
    expect(classifyCompletionEnforcement(root, A)).toMatchObject({
      enforce: true,
      reason: 'edited-this-turn',
    });
    expect(editedDevelopmentThisTurn(root, A)).toBe(true);
  });

  it('AC-10: a stage-agent row recorded this turn counts as edited this turn', () => {
    const root = tempRoot();
    const dirO = ownChange(root, A, BEFORE);
    stageAgentRow(root, A, dirO, AFTER);
    route(root, A, DETOUR);

    expect(classifyCompletionEnforcement(root, A)).toMatchObject({
      enforce: true,
      reason: 'edited-this-turn',
    });
  });

  it('does not count a stage-agent row from another session in its own bundle', () => {
    const root = tempRoot();
    const dirO = ownChange(root, A, BEFORE);
    stageAgentRow(root, SUB, dirO, AFTER);
    agentDevelopmentRow(root, dirO, AFTER);
    route(root, A, DETOUR);

    const owned = sessionOwnedRows(root, A);
    expect(owned.some((row) => row.session_id === SUB)).toBe(false);
    expect(classifyCompletionEnforcement(root, A)).toMatchObject({
      enforce: false,
      reason: 'detour',
    });
  });

  it('does not count its own stage-agent row written before its last prompt', () => {
    const root = tempRoot();
    const dirO = ownChange(root, A, BEFORE);
    stageAgentRow(root, A, dirO, BEFORE);
    route(root, A, DETOUR);

    expect(sessionOwnedRows(root, A).some((row) => row.kind === 'stage-agent')).toBe(false);
  });

  it('counts a stage-agent row from any session when the session has no prompt stamp', () => {
    const root = tempRoot();
    const dirO = ownChange(root, A, BEFORE);
    stageAgentRow(root, SUB, dirO, BEFORE);
    route(root, A, { active: { workflow: 'project-question' }, paused: [] });

    expect(sessionOwnedRows(root, A).some((row) => row.session_id === SUB)).toBe(true);
  });

  it('AC-10: a stage-agent row recorded before turn_started_at does not count as this turn', () => {
    const root = tempRoot();
    const dirO = ownChange(root, A, BEFORE);
    stageAgentRow(root, SUB, dirO, BEFORE);
    agentDevelopmentRow(root, dirO, BEFORE);
    route(root, A, DETOUR);

    expect(classifyCompletionEnforcement(root, A)).toMatchObject({
      enforce: false,
      reason: 'detour',
    });
  });

  it('AC-10: another session’s active bundle is not read', () => {
    const root = tempRoot();
    const dirB = ownChange(root, B, BEFORE);
    agentDevelopmentRow(root, dirB, AFTER);
    stageAgentRow(root, B, dirB, AFTER);
    route(root, A, { active: { workflow: 'project-question' }, paused: [], turn_started_at: TURN });

    expect(sessionOwnedRows(root, A)).toEqual([]);
    expect(classifyCompletionEnforcement(root, A)).toMatchObject({
      enforce: false,
      reason: 'not-owner',
    });

    ownChange(root, A, BEFORE);
    route(root, A, DETOUR);
    expect(classifyCompletionEnforcement(root, A)).toMatchObject({
      enforce: false,
      reason: 'detour',
    });
  });
});
