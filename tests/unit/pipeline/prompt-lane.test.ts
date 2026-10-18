import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ClassificationResult } from '@/core/types/classification.js';
import {
  isBareTicketPrompt,
  isSystemNotificationPrompt,
  resolvePromptRoute,
  runPromptRouteSeam,
  slashCommandName,
  SLASH_COMMAND_ROUTES,
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

  it('leaves the lane unresolved for a bare ticket/URL prompt, even off a confident guess (issue #602, FR-5/AC-5)', async () => {
    const { routed, lane, reason } = await resolvePromptRoute(
      root,
      'https://github.com/Eliyce/paqad-ai/issues/602\n- small commits\n- on PR\n- watch for green CI',
      {
        classify: async () => classificationWith('feature-development'),
        // Even when the surface-text classifier is confident it is a big change...
        route: () => ({ lane: 'full' }),
      },
    );
    expect(routed).toBe('feature-development');
    // ...a bare link must not lock a lane from surface text.
    expect(lane).toBeNull();
    expect(reason).toContain('reading the ticket');
  });
});

describe('isBareTicketPrompt (issue #602)', () => {
  it('is true when nothing but a link and process/filler words remain', () => {
    expect(isBareTicketPrompt('https://example.com/x/y/602')).toBe(true);
    expect(isBareTicketPrompt('implement #602 please')).toBe(true);
    expect(isBareTicketPrompt('PROJ-123')).toBe(true);
    expect(
      isBareTicketPrompt(
        'https://github.com/Eliyce/paqad-ai/issues/602\n- small commits\n- on PR\n- watch for green CI',
      ),
    ).toBe(true);
  });

  it('is false when the prompt actually describes the work', () => {
    expect(isBareTicketPrompt('add a dark mode toggle #500')).toBe(false);
    expect(isBareTicketPrompt('fix the login redirect bug in checkout #12')).toBe(false);
  });

  it('is false when there is no link at all', () => {
    expect(isBareTicketPrompt('implement this please')).toBe(false);
    expect(isBareTicketPrompt('')).toBe(false);
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

  it('stashes no lane for a bare ticket/URL prompt (issue #602, FR-5)', async () => {
    const result = await runPromptRouteSeam(
      {
        projectRoot: root,
        request: 'https://github.com/Eliyce/paqad-ai/issues/602 — small commits, on PR',
        sessionId: SESSION,
        adapter: ADAPTER,
      },
      {
        classify: async () => classificationWith('feature-development'),
        route: () => ({ lane: 'full' }),
      },
    );
    expect(result.routed).toBe('feature-development');
    expect(result.lane).toBeNull();
    // No confident lane is stashed for the change-open to pick up.
    expect(readPendingLane(root, resolveSessionId(root, SESSION))).toBeNull();
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

  // Issue #582 (FR-10) — the route is also written under this session's own pointer.
  it('writes the route under the session own pointer too (issue #582)', async () => {
    await runPromptRouteSeam(
      {
        projectRoot: root,
        request: 'explain the router',
        sessionId: SESSION,
        adapter: 'claude-code',
      },
      { classify: async () => classificationWith('project-question') },
    );
    await runPromptRouteSeam({
      projectRoot: root,
      request: 'implement a schema migration adding a pii payment column',
      sessionId: 'other-session',
      adapter: 'claude-code',
    });
    expect(readSessionRoute(root, SESSION)?.workflow).toBe('project-question');
    expect(readSessionRoute(root)?.workflow).toBe('feature-development');
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
      // Issue #639, Part 7 — the router's reason is saved with the route.
      active: {
        workflow: 'project-question',
        reason: 'a question about the project — no code change',
      },
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

// Issue #615 (Part 2) — on the Desktop app a finished background agent arrives as a prompt
// that OPENS with a banner line and only then carries the element. Representative shape (the
// real captured Desktop payload is a manual check noted in the PR). It mentions issue numbers
// in its body, which is exactly what used to trip routing and ticket intake.
const DESKTOP_BANNER_NOTIFICATION = [
  '[SYSTEM NOTIFICATION - NOT USER INPUT]',
  'This is an automated background-task event, NOT a message from the user.',
  '',
  '<task-notification>',
  '<task-id>a1b2c3</task-id>',
  '<summary>Background agent finished reviewing #409 and #582</summary>',
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

  it('recognises the Desktop banner-led background notice (issue #615, Part 2)', () => {
    expect(isSystemNotificationPrompt(DESKTOP_BANNER_NOTIFICATION)).toBe(true);
    // Case-insensitive and tolerant of leading whitespace, like the element anchor.
    expect(isSystemNotificationPrompt('\n  [system notification - not user input]\nx')).toBe(true);
  });

  it('leaves a human prompt that only MENTIONS the banner routable (issue #615)', () => {
    expect(
      isSystemNotificationPrompt('what is the [SYSTEM NOTIFICATION - NOT USER INPUT] banner?'),
    ).toBe(false);
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
      // Issue #582 — flagged so the prompt gate keeps the full context block.
      notification: true,
    });
  });

  it('does not flag a real request as a notification (issue #582)', async () => {
    const result = await runPromptRouteSeam({
      projectRoot: root,
      request: 'thanks!',
      sessionId: SESSION,
      adapter: ADAPTER,
    });
    expect(result.notification).toBeUndefined();
  });

  it('treats a Desktop banner-led notice as a notification (issue #615, Part 2)', async () => {
    const result = await runPromptRouteSeam({
      projectRoot: root,
      request: DESKTOP_BANNER_NOTIFICATION,
      sessionId: SESSION,
      adapter: ADAPTER,
    });
    expect(result).toEqual({
      routed: 'no-workflow',
      lane: null,
      resumed: null,
      narration: null,
      notification: true,
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

// Issue #615 (Part 5) — slash commands reach the seam as the raw typed line.
describe('slashCommandName (issue #615, Part 5)', () => {
  it('extracts the command name, including the segment after the last colon', () => {
    expect(slashCommandName('/code-review high')).toBe('code-review');
    expect(slashCommandName('/paqad-discover add an export button')).toBe('paqad-discover');
    expect(slashCommandName('/paqad-product-discovery:paqad-discover shape it')).toBe(
      'paqad-discover',
    );
    expect(slashCommandName('/simplify')).toBe('simplify');
  });

  it('returns null for a non-slash prompt or a mid-sentence path', () => {
    expect(slashCommandName('fix the bug')).toBeNull();
    expect(slashCommandName('open the file at /path/like/this please')).toBeNull();
    expect(slashCommandName('')).toBeNull();
  });

  it('keeps the route map as the single source of truth', () => {
    expect(SLASH_COMMAND_ROUTES['paqad-discover']).toBe('discovery');
    expect(SLASH_COMMAND_ROUTES['paqad-ask']).toBe('project-question');
    expect(SLASH_COMMAND_ROUTES['code-review']).toBeUndefined();
  });
});

describe('runPromptRouteSeam with slash commands (issue #615, Part 5)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-route-slash-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('leaves the stored route unchanged for an unknown slash command', async () => {
    let classified = 0;
    const result = await runPromptRouteSeam(
      { projectRoot: root, request: '/code-review high', sessionId: SESSION, adapter: ADAPTER },
      {
        classify: async () => {
          classified += 1;
          return classificationWith('feature-development');
        },
      },
    );
    expect(result).toEqual({
      routed: 'no-workflow',
      lane: null,
      resumed: null,
      narration: null,
      notification: true,
    });
    expect(classified).toBe(0); // never classified as prose
  });

  it('routes /paqad-discover to discovery', async () => {
    const result = await runPromptRouteSeam({
      projectRoot: root,
      request: '/paqad-discover add an export button',
      sessionId: SESSION,
      adapter: ADAPTER,
    });
    expect(result.routed).toBe('discovery');
    expect(result.lane).toBeNull();
    expect(result.notification).toBeUndefined();
    expect(result.narration).toContain('discovery');
  });

  it('routes /paqad-ask to project-question', async () => {
    const result = await runPromptRouteSeam({
      projectRoot: root,
      request: '/paqad-ask what does this project do?',
      sessionId: SESSION,
      adapter: ADAPTER,
    });
    expect(result.routed).toBe('project-question');
  });

  it('still routes a prose prompt that contains a mid-sentence path', async () => {
    const result = await runPromptRouteSeam(
      {
        projectRoot: root,
        request: 'update the config at /etc/app/config.yaml',
        sessionId: SESSION,
        adapter: ADAPTER,
      },
      { classify: async () => classificationWith('feature-development') },
    );
    // Went through normal routing (not the slash short-circuit), so it is not flagged.
    expect(result.notification).toBeUndefined();
  });
});
