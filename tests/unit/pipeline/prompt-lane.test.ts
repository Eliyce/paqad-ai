import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ClassificationResult } from '@/core/types/classification.js';
import {
  isSystemNotificationPrompt,
  resolvePromptRoute,
  runPromptRouteSeam,
  SYSTEM_NOTIFICATION_ELEMENTS,
} from '@/pipeline/prompt-lane.js';
import { readSessionRoute } from '@/pipeline/session-route.js';
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

  it('records the routing host on the session route (issue #566, AC-8)', async () => {
    await runPromptRouteSeam(
      {
        projectRoot: root,
        request: 'explain how the router works',
        sessionId: SESSION,
        adapter: 'codex-cli',
      },
      { classify: async () => classificationWith('project-question') },
    );
    expect(readSessionRoute(root)?.adapter).toBe('codex-cli');
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

  it('stamps turn_started_at on every routed prompt (#582)', async () => {
    const sessionId = resolveSessionId(root, SESSION);
    const ask = (at: string) =>
      runPromptRouteSeam(
        { projectRoot: root, request: 'explain the router', sessionId: SESSION, adapter: ADAPTER },
        {
          classify: async () => classificationWith('project-question'),
          now: () => new Date(at),
        },
      );

    await ask('2026-03-01T10:00:00.000Z');
    expect(readWorkflowState(root, sessionId).turn_started_at).toBe('2026-03-01T10:00:00.000Z');

    // A second prompt (continuing the same workflow) moves the stamp to its own turn.
    await ask('2026-03-01T11:30:00.000Z');
    expect(readWorkflowState(root, sessionId)).toEqual({
      active: { workflow: 'project-question' },
      paused: [],
      turn_started_at: '2026-03-01T11:30:00.000Z',
    });
  });
});

// Issue #540 — a background event reaches UserPromptSubmit exactly like a typed prompt.
// Verbatim payload from the incident transcript (session b7c32628, 2026-09-10T14:00:08Z).
const TASK_NOTIFICATION = [
  '<task-notification>',
  '<task-id>besdej0sh</task-id>',
  '<summary>Monitor event: "CI checks on PR #539 until all complete"</summary>',
  '<event>Analyze (javascript-typescript): pass',
  'CodeQL: pass</event>',
  'If this event is something the user would act on now, send a PushNotification.',
  '</task-notification>',
].join('\n');

describe('isSystemNotificationPrompt (#540)', () => {
  it('recognises every wrapper element the host injects', () => {
    for (const element of SYSTEM_NOTIFICATION_ELEMENTS) {
      expect(isSystemNotificationPrompt(`<${element}>anything</${element}>`)).toBe(true);
    }
  });

  it('recognises the real monitor-event payload, leading whitespace and all', () => {
    expect(isSystemNotificationPrompt(TASK_NOTIFICATION)).toBe(true);
    expect(isSystemNotificationPrompt(`\n  ${TASK_NOTIFICATION}`)).toBe(true);
    expect(isSystemNotificationPrompt('<TASK-NOTIFICATION>x</TASK-NOTIFICATION>')).toBe(true);
  });

  it('leaves a human prompt that only MENTIONS a wrapper routable', () => {
    // The prompt that filed this very issue quotes the element mid-sentence.
    expect(isSystemNotificationPrompt('why did the <task-notification> open a new change?')).toBe(
      false,
    );
    expect(isSystemNotificationPrompt('verify and fix issue 540')).toBe(false);
    expect(isSystemNotificationPrompt('')).toBe(false);
  });
});

describe('runPromptRouteSeam with a background notification (#540)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-route-notify-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('routes nothing and narrates nothing (AC-6)', async () => {
    const result = await runPromptRouteSeam({
      projectRoot: root,
      request: TASK_NOTIFICATION,
      sessionId: SESSION,
      adapter: ADAPTER,
    });
    expect(result).toEqual({
      routed: 'no-workflow',
      lane: null,
      resumed: null,
      narration: null,
    });
  });

  it('leaves an in-flight feature-development route exactly as it was (AC-6)', async () => {
    const sessionId = resolveSessionId(root, SESSION);
    const inFlight = {
      active: {
        workflow: 'feature-development' as const,
        changeKey: 'sess#1',
        lane: 'full' as const,
      },
      paused: [],
    };
    writeWorkflowState(root, sessionId, inFlight);

    await runPromptRouteSeam({
      projectRoot: root,
      request: TASK_NOTIFICATION,
      sessionId: SESSION,
      adapter: ADAPTER,
    });

    // Recording `no-workflow` here would pause the change and make
    // `routeIsAffirmativelyNonFeature` true — silently suppressing stage recording
    // for the rest of it. Nothing is written at all instead.
    expect(readWorkflowState(root, sessionId)).toEqual(inFlight);
    expect(readPendingLane(root, sessionId)).toBeNull();
    expect(readSessionRoute(root)).toBeNull();
  });

  it('AC-13: leaves turn_started_at unchanged (#582)', async () => {
    const sessionId = resolveSessionId(root, SESSION);
    const stamped = {
      active: { workflow: 'project-question' as const },
      paused: [],
      turn_started_at: '2026-03-01T10:00:00.000Z',
    };
    writeWorkflowState(root, sessionId, stamped);

    await runPromptRouteSeam(
      { projectRoot: root, request: TASK_NOTIFICATION, sessionId: SESSION, adapter: ADAPTER },
      { now: () => new Date('2026-03-01T12:00:00.000Z') },
    );

    expect(readWorkflowState(root, sessionId)).toEqual(stamped);
  });

  it('never calls the classifier for a notification', async () => {
    let classified = 0;
    await runPromptRouteSeam(
      {
        projectRoot: root,
        request: TASK_NOTIFICATION,
        sessionId: SESSION,
        adapter: ADAPTER,
      },
      {
        classify: async () => {
          classified += 1;
          return classificationWith('feature-development');
        },
      },
    );
    expect(classified).toBe(0);
  });
});
