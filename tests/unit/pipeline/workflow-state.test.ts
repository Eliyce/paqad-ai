import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sessionLedgerDir } from '@/session-ledger/ledger.js';
import { STAGE_EVIDENCE_DOC_TYPE } from '@/stage-evidence/types.js';
import {
  readWorkflowState,
  routeWorkflow,
  writeWorkflowState,
  type WorkflowState,
} from '@/pipeline/workflow-state.js';

const SESSION = 'sess-workflow-state';

function stateDir(root: string): string {
  return join(root, sessionLedgerDir(STAGE_EVIDENCE_DOC_TYPE, SESSION));
}

describe('workflow-state store (#336)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-wf-state-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('round-trips a written state', () => {
    const state: WorkflowState = {
      active: {
        workflow: 'feature-development',
        changeKey: 'sess#1',
        lane: 'full',
        specId: 'spec-a',
      },
      paused: [{ workflow: 'project-question' }],
    };
    writeWorkflowState(root, SESSION, state);
    expect(readWorkflowState(root, SESSION)).toEqual(state);
  });

  it('returns the empty default when nothing was written', () => {
    expect(readWorkflowState(root, SESSION)).toEqual({ active: null, paused: [] });
  });

  it('returns the empty default on unreadable/invalid JSON', () => {
    mkdirSync(stateDir(root), { recursive: true });
    writeFileSync(join(stateDir(root), '.workflow-state.json'), '{not json', 'utf8');
    expect(readWorkflowState(root, SESSION)).toEqual({ active: null, paused: [] });
  });

  it('drops invalid entries and a non-array paused field', () => {
    mkdirSync(stateDir(root), { recursive: true });
    writeFileSync(
      join(stateDir(root), '.workflow-state.json'),
      JSON.stringify({
        active: { workflow: 'not-a-workflow' },
        paused: 'nope',
      }),
      'utf8',
    );
    expect(readWorkflowState(root, SESSION)).toEqual({ active: null, paused: [] });
  });

  it('keeps only recognised anchor fields and a valid lane', () => {
    mkdirSync(stateDir(root), { recursive: true });
    writeFileSync(
      join(stateDir(root), '.workflow-state.json'),
      JSON.stringify({
        active: { workflow: 'feature-development', lane: 'bogus', changeKey: 5, specId: 'ok' },
        paused: [{ workflow: 'pentest' }, { nope: true }, 42],
      }),
      'utf8',
    );
    expect(readWorkflowState(root, SESSION)).toEqual({
      active: { workflow: 'feature-development', specId: 'ok' },
      paused: [{ workflow: 'pentest' }],
    });
  });

  it('continues (does not switch) when routing to the same active workflow, merging anchors', () => {
    const start: WorkflowState = {
      active: { workflow: 'feature-development', lane: 'graduated' },
      paused: [],
    };
    const t = routeWorkflow(start, 'feature-development', { changeKey: 'sess#2' });
    expect(t.switched).toBe(false);
    expect(t.resumed).toBeNull();
    expect(t.state.active).toEqual({
      workflow: 'feature-development',
      lane: 'graduated',
      changeKey: 'sess#2',
    });
  });

  it('activates from an empty state without marking it a switch', () => {
    const t = routeWorkflow({ active: null, paused: [] }, 'project-question');
    expect(t.switched).toBe(false);
    expect(t.resumed).toBeNull();
    expect(t.state).toEqual({ active: { workflow: 'project-question' }, paused: [] });
  });

  it('pauses the active workflow when switching to a new one (not a reset)', () => {
    const start: WorkflowState = {
      active: { workflow: 'feature-development', changeKey: 'sess#3', lane: 'full', specId: 's' },
      paused: [],
    };
    const t = routeWorkflow(start, 'project-question');
    expect(t.switched).toBe(true);
    expect(t.resumed).toBeNull();
    expect(t.state.active).toEqual({ workflow: 'project-question' });
    // the feature-development change is preserved with its anchors, not lost
    expect(t.state.paused).toEqual([
      { workflow: 'feature-development', changeKey: 'sess#3', lane: 'full', specId: 's' },
    ]);
  });

  it('resumes a paused workflow (pops it with anchors) and pauses the current one', () => {
    const start: WorkflowState = {
      active: { workflow: 'project-question' },
      paused: [{ workflow: 'feature-development', changeKey: 'sess#4', lane: 'full', specId: 's' }],
    };
    const t = routeWorkflow(start, 'feature-development');
    expect(t.switched).toBe(true);
    expect(t.resumed).toEqual({
      workflow: 'feature-development',
      changeKey: 'sess#4',
      lane: 'full',
      specId: 's',
    });
    expect(t.state.active).toEqual({
      workflow: 'feature-development',
      changeKey: 'sess#4',
      lane: 'full',
      specId: 's',
    });
    expect(t.state.paused).toEqual([{ workflow: 'project-question' }]);
  });

  it('does not overwrite existing anchors with undefined on continue', () => {
    const start: WorkflowState = {
      active: {
        workflow: 'feature-development',
        changeKey: 'keep',
        lane: 'full',
        specId: 'keep-s',
      },
      paused: [],
    };
    const t = routeWorkflow(start, 'feature-development', {});
    expect(t.state.active).toEqual({
      workflow: 'feature-development',
      changeKey: 'keep',
      lane: 'full',
      specId: 'keep-s',
    });
  });
});
