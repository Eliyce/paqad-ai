import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { featureFilePath } from '@/feature-evidence/paths.js';
import {
  appendFeatureStageRow,
  closeActiveFeature,
  openFeatureChange,
} from '@/feature-evidence/stage-ledger.js';
import { classifyCompletionEnforcement, sessionOwnedRows } from '@/pipeline/session-ownership.js';
import { writeWorkflowState, type WorkflowState } from '@/pipeline/workflow-state.js';
import { endStage, startStage } from '@/stage-evidence/recorder.js';

// Issue #582 — the completion check enforces only for a session that OWNS a change
// (agent-authored rows stamped with its id in an unclosed bundle), and the route can only
// turn a detour off, never make a non-owner enforce.

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

/** Open a bundle for `session` and live-mark a development start at `now`. */
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
        adapter: 'backstop',
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
      adapter: 'claude-code',
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
    // A directory where the JSONL file should be: the read throws, which must not escape.
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
    // A hand-damaged row: the ledger read keeps it (ts is a string), but it names no time.
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

  it('resolves the session from the cache when no id is passed', () => {
    const root = tempRoot();
    ownChange(root, A);
    // Resolving A with an explicit hint caches it; a later no-hint read resolves the same id.
    route(root, A, { active: null, paused: [], turn_started_at: TURN });
    classifyCompletionEnforcement(root, A);
    expect(classifyCompletionEnforcement(root, null).reason).toBe('owner-unknown-route');
  });
});
