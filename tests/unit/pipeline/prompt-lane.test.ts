import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ClassificationResult } from '@/core/types/classification.js';
import { resolvePromptRoute, runPromptRouteSeam } from '@/pipeline/prompt-lane.js';
import { readPendingLane } from '@/stage-evidence/pending-lane.js';
import { readWorkflowState, writeWorkflowState } from '@/pipeline/workflow-state.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

const SESSION = 'sess-prompt-route';
const ADAPTER = 'claude-code';

/** Minimal classification stub — only the `workflow` field drives routing. */
function classificationWith(workflow: ClassificationResult['workflow']): ClassificationResult {
  return { workflow } as ClassificationResult;
}

describe('resolvePromptRoute (#336)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-prompt-route-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('routes a risky, wide-reaching feature change to feature-development on the full lane', async () => {
    const { routed, lane, reason } = await resolvePromptRoute(
      root,
      'implement a schema migration adding a pii payment column and a breaking api change',
    );
    expect(routed).toBe('feature-development');
    expect(lane).toBe('full');
    expect(reason).toContain('full path');
  });

  it('routes a trivial fix to feature-development on the fast lane', async () => {
    const { routed, lane, reason } = await resolvePromptRoute(
      root,
      'fix a one-line typo in a code comment',
    );
    expect(routed).toBe('feature-development');
    expect(lane).toBe('fast');
    expect(reason).toContain('quick path');
  });

  it('routes a project-question classification to project-question with no lane', async () => {
    const { routed, lane, reason } = await resolvePromptRoute(root, 'what does this project do', {
      classify: async () => classificationWith('project-question'),
    });
    expect(routed).toBe('project-question');
    expect(lane).toBeNull();
    expect(reason).toContain('no code change');
  });

  it('never picks a lane for a non-feature-development outcome (injected)', async () => {
    const { routed, lane, reason } = await resolvePromptRoute(root, 'anything', {
      classify: async () => classificationWith('pentest'),
      route: () => ({ lane: 'full' }), // would-be lane is ignored off the feature-dev route
    });
    expect(routed).toBe('pentest');
    expect(lane).toBeNull();
    expect(reason).toContain('security test');
  });

  it('falls back to the feature-development reason when the router yields no lane (injected)', async () => {
    const { routed, lane, reason } = await resolvePromptRoute(root, 'anything', {
      classify: async () => classificationWith('feature-development'),
      route: () => ({ lane: null }),
    });
    expect(routed).toBe('feature-development');
    expect(lane).toBeNull();
    expect(reason).toContain('full build path');
  });
});

describe('runPromptRouteSeam (#336)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-route-seam-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('stashes the lane, records the outcome, and narrates for a feature change', async () => {
    const result = await runPromptRouteSeam({
      projectRoot: root,
      request: 'implement a schema migration adding a pii payment column',
      sessionId: SESSION,
      adapter: ADAPTER,
    });
    expect(result.routed).toBe('feature-development');
    expect(result.lane).toBe('full');
    expect(result.narration).toContain('feature-development');
    expect(result.narration).toContain('full lane');
    const sessionId = resolveSessionId(root, SESSION);
    expect(readPendingLane(root, sessionId)).toBe('full');
    expect(readWorkflowState(root, sessionId).active?.workflow).toBe('feature-development');
  });

  it('records project-question and stashes no lane for a question', async () => {
    const result = await runPromptRouteSeam(
      {
        projectRoot: root,
        request: 'explain how the router works',
        sessionId: SESSION,
        adapter: ADAPTER,
      },
      { classify: async () => classificationWith('project-question') },
    );
    expect(result.routed).toBe('project-question');
    expect(result.lane).toBeNull();
    expect(result.narration).toContain('project-question');
    const sessionId = resolveSessionId(root, SESSION);
    expect(readPendingLane(root, sessionId)).toBeNull();
    expect(readWorkflowState(root, sessionId).active?.workflow).toBe('project-question');
  });

  it('preserves a paused feature-development change when a question interrupts it (AC-10)', async () => {
    const sessionId = resolveSessionId(root, SESSION);
    writeWorkflowState(root, sessionId, {
      active: { workflow: 'feature-development', changeKey: 'sess#1', lane: 'full', specId: 'sp' },
      paused: [],
    });
    await runPromptRouteSeam(
      {
        projectRoot: root,
        request: 'what does this project do',
        sessionId: SESSION,
        adapter: ADAPTER,
      },
      { classify: async () => classificationWith('project-question') },
    );
    const state = readWorkflowState(root, sessionId);
    expect(state.active?.workflow).toBe('project-question');
    expect(state.paused).toEqual([
      { workflow: 'feature-development', changeKey: 'sess#1', lane: 'full', specId: 'sp' },
    ]);
  });

  it('resumes a paused feature-development change and narrates the resume (AC-11)', async () => {
    const sessionId = resolveSessionId(root, SESSION);
    writeWorkflowState(root, sessionId, {
      active: { workflow: 'project-question' },
      paused: [
        { workflow: 'feature-development', changeKey: 'sess#1', lane: 'full', specId: 'sp' },
      ],
    });
    const result = await runPromptRouteSeam({
      projectRoot: root,
      request: 'implement a schema migration adding a pii payment column',
      sessionId: SESSION,
      adapter: ADAPTER,
    });
    expect(result.routed).toBe('feature-development');
    expect(result.resumed).toEqual({
      workflow: 'feature-development',
      changeKey: 'sess#1',
      lane: 'full',
      specId: 'sp',
    });
    expect(result.narration).toContain('Resumed');
  });
});
