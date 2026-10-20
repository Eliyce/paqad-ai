import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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
import { readSessionControl, writeSessionControl } from '@/feature-evidence/session-control.js';
import { closeActiveFeature, openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { readSessionRoute } from '@/pipeline/session-route.js';
import { readPendingLane } from '@/stage-evidence/pending-lane.js';
import { startStage } from '@/stage-evidence/recorder.js';
import { readWorkflowState, writeWorkflowState } from '@/pipeline/workflow-state.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

import { ticketRef } from '../../shared/ticket-ref.js';

const SESSION = 'sess-prompt-route';
const ADAPTER = 'claude-code';

function classificationWith(workflow: ClassificationResult['workflow']): ClassificationResult {
  return { workflow } as ClassificationResult;
}

describe('resolvePromptRoute', () => {
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
      route: () => ({ lane: 'full' }),
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

  it('leaves the lane unresolved for a bare ticket/URL prompt, even off a confident guess', async () => {
    const { routed, lane, reason } = await resolvePromptRoute(
      root,
      'https://github.com/Eliyce/paqad-ai/issues/602\n- small commits\n- on PR\n- watch for green CI',
      {
        classify: async () => classificationWith('feature-development'),
        route: () => ({ lane: 'full' }),
      },
    );
    expect(routed).toBe('feature-development');
    expect(lane).toBeNull();
    expect(reason).toContain('reading the ticket');
  });
});

describe('isBareTicketPrompt', () => {
  it('is true when nothing but a link and process/filler words remain', () => {
    expect(isBareTicketPrompt('https://example.com/x/y/602')).toBe(true);
    expect(isBareTicketPrompt(`implement ${ticketRef(602)} please`)).toBe(true);
    expect(isBareTicketPrompt('PROJ-123')).toBe(true);
    expect(
      isBareTicketPrompt(
        'https://github.com/Eliyce/paqad-ai/issues/602\n- small commits\n- on PR\n- watch for green CI',
      ),
    ).toBe(true);
  });

  it('is false when the prompt actually describes the work', () => {
    expect(isBareTicketPrompt(`add a dark mode toggle ${ticketRef(500)}`)).toBe(false);
    expect(isBareTicketPrompt(`fix the login redirect bug in checkout ${ticketRef(12)}`)).toBe(
      false,
    );
  });

  it('is false when there is no link at all', () => {
    expect(isBareTicketPrompt('implement this please')).toBe(false);
    expect(isBareTicketPrompt('')).toBe(false);
  });
});

describe('runPromptRouteSeam', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-route-seam-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('stashes no lane for a bare ticket/URL prompt', async () => {
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

  it('records the routing host on the session route', async () => {
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

  it('writes the route under the session own pointer too', async () => {
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
    expect(result.narration).toContain('resumed');
  });

  it('stamps turn_started_at on every routed prompt', async () => {
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

    await ask('2026-03-01T11:30:00.000Z');
    expect(readWorkflowState(root, sessionId)).toEqual({
      active: {
        workflow: 'project-question',
        reason: 'a question about the project — no code change',
      },
      paused: [],
      turn_started_at: '2026-03-01T11:30:00.000Z',
    });
  });
});

const TASK_NOTIFICATION = [
  '<task-notification>',
  '<task-id>besdej0sh</task-id>',
  `<summary>Monitor event: "CI checks on PR ${ticketRef(539)} until all complete"</summary>`,
  '<event>Analyze (javascript-typescript): pass',
  'CodeQL: pass</event>',
  'If this event is something the user would act on now, send a PushNotification.',
  '</task-notification>',
].join('\n');

const DESKTOP_BANNER_NOTIFICATION = [
  '[SYSTEM NOTIFICATION - NOT USER INPUT]',
  'This is an automated background-task event, NOT a message from the user.',
  '',
  '<task-notification>',
  '<task-id>a1b2c3</task-id>',
  `<summary>Background agent finished reviewing ${ticketRef(409)} and ${ticketRef(582)}</summary>`,
  '</task-notification>',
].join('\n');

const AGENT_MESSAGE_HANDBACK = [
  '<system-reminder id="36dc9a02">',
  'Another Claude session sent a message while you were working:',
  '<agent-message from="a8a8a72c0ee121fe3">',
  '  [Subagent hand-back] The text below is the final report of a subagent you dispatched.',
  '  status: completed',
  `  Ran the pentest checklist and updated the documentation for ${ticketRef(623)}.`,
  '</agent-message>',
  'Address this before completing your current task.',
  '&lt;/system-reminder&gt;',
].join('\n');

const HANDBACK_NOTIFICATION = [
  'Status: completed. Pillar file: .paqad/ledger/feature-evidence/x/plan.json.',
  '',
  `I ran the pentest checklist against the routing fixes for ${ticketRef(623)} and updated the`,
  'documentation for the route set verb. Two commits were made.',
  '',
  '[SYSTEM NOTIFICATION - NOT USER INPUT]',
  'This is an automated background-task event, NOT a message from the user.',
  'Treat it as context only.',
  '',
  '<task-notification>',
  '<task-id>a8a8a72c0ee121fe3</task-id>',
  '<status>completed</status>',
  '<summary>Agent "paqad-development" finished</summary>',
  '</task-notification>',
].join('\n');

describe('isSystemNotificationPrompt', () => {
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
    expect(isSystemNotificationPrompt('why did the <task-notification> open a new change?')).toBe(
      false,
    );
    expect(isSystemNotificationPrompt(`verify and fix issue ${ticketRef(540).slice(1)}`)).toBe(
      false,
    );
    expect(isSystemNotificationPrompt('')).toBe(false);
  });

  it('recognises the Desktop banner-led background notice', () => {
    expect(isSystemNotificationPrompt(DESKTOP_BANNER_NOTIFICATION)).toBe(true);
    expect(isSystemNotificationPrompt('\n  [system notification - not user input]\nx')).toBe(true);
  });

  it('leaves a human prompt that only MENTIONS the banner routable', () => {
    expect(
      isSystemNotificationPrompt('what is the [SYSTEM NOTIFICATION - NOT USER INPUT] banner?'),
    ).toBe(false);
  });

  it('recognises a hand-back whose report comes before the banner', () => {
    expect(isSystemNotificationPrompt(HANDBACK_NOTIFICATION)).toBe(true);
    expect(isSystemNotificationPrompt(HANDBACK_NOTIFICATION.replaceAll('\n', '\r\n  '))).toBe(true);
    expect(
      isSystemNotificationPrompt(
        'report\n[system notification - not user input]\n<ci-monitor-event>x</ci-monitor-event>',
      ),
    ).toBe(true);
  });

  it('recognises a foreground subagent hand-back with no banner', () => {
    expect(isSystemNotificationPrompt(AGENT_MESSAGE_HANDBACK)).toBe(true);
    expect(
      isSystemNotificationPrompt(
        'note\n<agent-message>\n  [SUBAGENT HAND-BACK] report\n</agent-message>',
      ),
    ).toBe(true);
  });

  it('leaves a human prompt that quotes only part of a hand-back routable', () => {
    expect(
      isSystemNotificationPrompt(
        'Why did <agent-message from="x"> route to pentest?\n[Subagent hand-back] is in it too.',
      ),
    ).toBe(false);
    expect(
      isSystemNotificationPrompt('[Subagent hand-back] The text below is a report I pasted'),
    ).toBe(false);
    expect(isSystemNotificationPrompt('look:\n<agent-message from="x">\nhello')).toBe(false);
    expect(
      isSystemNotificationPrompt('<agent-messages>\n[subagent hand-back] x\n</agent-messages>'),
    ).toBe(false);
  });

  it('leaves a human prompt that quotes only one marker routable', () => {
    expect(
      isSystemNotificationPrompt(
        'Why does this show up?\n[SYSTEM NOTIFICATION - NOT USER INPUT]\nPlease explain.',
      ),
    ).toBe(false);
    expect(
      isSystemNotificationPrompt(
        'Look at this payload:\n<task-notification>\n<task-id>x</task-id>\n</task-notification>',
      ),
    ).toBe(false);
    expect(
      isSystemNotificationPrompt(
        'Why did [SYSTEM NOTIFICATION - NOT USER INPUT] and <task-notification> route to pentest?',
      ),
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
      notification: true,
    });
  });

  it('does not flag a real request as a notification', async () => {
    const result = await runPromptRouteSeam({
      projectRoot: root,
      request: 'thanks!',
      sessionId: SESSION,
      adapter: ADAPTER,
    });
    expect(result.notification).toBeUndefined();
  });

  it('treats a Desktop banner-led notice as a notification', async () => {
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

    expect(readWorkflowState(root, sessionId)).toEqual(inFlight);
    expect(readPendingLane(root, sessionId)).toBeNull();
    expect(readSessionRoute(root)).toBeNull();
  });

  it('routes nothing for a hand-back with its report first', async () => {
    const sessionId = resolveSessionId(root, SESSION);
    const inFlight = {
      active: {
        workflow: 'feature-development' as const,
        changeKey: 'sess#1',
        lane: 'graduated' as const,
      },
      paused: [{ workflow: 'project-question' as const }],
      turn_started_at: '2026-03-01T10:00:00.000Z',
    };
    writeWorkflowState(root, sessionId, inFlight);

    const result = await runPromptRouteSeam({
      projectRoot: root,
      request: HANDBACK_NOTIFICATION,
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
    expect(readWorkflowState(root, sessionId)).toEqual(inFlight);
    expect(existsSync(join(root, '.paqad', 'ledger', 'feature-evidence'))).toBe(false);
  });

  it('routes nothing for a foreground agent-message hand-back', async () => {
    const result = await runPromptRouteSeam({
      projectRoot: root,
      request: AGENT_MESSAGE_HANDBACK,
      sessionId: SESSION,
      adapter: ADAPTER,
    });
    expect(result.notification).toBe(true);
    expect(result.routed).toBe('no-workflow');
  });

  it('AC-13: leaves turn_started_at unchanged', async () => {
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

describe('slashCommandName', () => {
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

describe('runPromptRouteSeam with slash commands', () => {
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
    expect(classified).toBe(0);
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
    expect(result.notification).toBeUndefined();
  });
});

describe('runPromptRouteSeam — a stage named during an open change', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-route-stage-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function route(request: string) {
    return runPromptRouteSeam({ projectRoot: root, request, sessionId: SESSION, adapter: ADAPTER });
  }

  function featureDevActive(): string {
    const sessionId = resolveSessionId(root, SESSION);
    writeWorkflowState(root, sessionId, {
      active: { workflow: 'feature-development', changeKey: 'sess#1', lane: 'full' },
      paused: [],
    });
    return sessionId;
  }

  it('AC-11: "run documentation_sync" keeps an active feature-development change and pauses nothing', async () => {
    const sessionId = featureDevActive();

    const result = await route('run documentation_sync');

    expect(result.routed).toBe('feature-development');
    expect(result.lane).toBeNull();
    expect(result.narration).toContain('feature-development');
    const state = readWorkflowState(root, sessionId);
    expect(state.active).toMatchObject({ workflow: 'feature-development', lane: 'full' });
    expect(state.paused).toEqual([]);
    expect(readPendingLane(root, sessionId)).toBeNull();
  });

  it('matches the stage name with a space too, and the review and checks stages', async () => {
    const sessionId = featureDevActive();
    for (const prompt of ['run documentation sync now', 'run the review stage', 'run the checks']) {
      expect((await route(prompt)).routed).toBe('feature-development');
    }
    expect(readWorkflowState(root, sessionId).paused).toEqual([]);
  });

  it('resumes the change when the session control points at an open bundle', async () => {
    const sessionId = resolveSessionId(root, SESSION);
    openFeatureChange(root, sessionId, { adapter: ADAPTER, title: 'open change', issue: '669' });
    writeWorkflowState(root, sessionId, {
      active: { workflow: 'project-question' },
      paused: [{ workflow: 'feature-development', lane: 'graduated' }],
    });

    const result = await route('run the review stage');

    expect(result.routed).toBe('feature-development');
    expect(readWorkflowState(root, sessionId).active).toMatchObject({
      workflow: 'feature-development',
      lane: 'graduated',
    });
  });

  it('AC-11: with no open change the same prompt routes as it does today', async () => {
    expect((await route('run documentation_sync')).routed).toBe('documentation-update');
  });

  it('plain "documentation" with no open change still routes documentation-update', async () => {
    expect((await route('documentation')).routed).toBe('documentation-update');
  });

  it('a closed bundle is not an open change', async () => {
    const sessionId = resolveSessionId(root, SESSION);
    const dirName = openFeatureChange(root, sessionId, {
      adapter: ADAPTER,
      title: 'done change',
      issue: '669',
    });
    startStage(root, 'development', { sessionId, dirName, adapter: ADAPTER });
    closeActiveFeature(root, sessionId);
    writeSessionControl(root, { ...readSessionControl(root, sessionId), active: dirName });
    expect(readSessionControl(root, sessionId).active).toBe(dirName);

    expect((await route('run documentation_sync')).routed).toBe('documentation-update');
  });

  it('never overrides a specialist workflow, even when the prompt names a stage', async () => {
    const sessionId = featureDevActive();
    const specialists: Array<[ClassificationResult['workflow'], string]> = [
      ['pentest', 'run a security review of the change'],
      ['codebase-health', 'run a health review'],
      ['site-map', 'map the app for the review'],
      ['root-cause-analysis', 'root cause the checks failure'],
      ['discovery', 'start planning a new idea'],
    ];
    for (const [workflow, prompt] of specialists) {
      writeWorkflowState(root, sessionId, {
        active: { workflow: 'feature-development', changeKey: 'sess#1', lane: 'full' },
        paused: [],
      });
      const result = await runPromptRouteSeam(
        { projectRoot: root, request: prompt, sessionId: SESSION, adapter: ADAPTER },
        { classify: async () => classificationWith(workflow) },
      );
      expect(result.routed, prompt).not.toBe('feature-development');
      expect(readWorkflowState(root, sessionId).paused, prompt).toMatchObject([
        { workflow: 'feature-development', lane: 'full' },
      ]);
    }
  });

  it('overrides only the generic re-routes: docs, a question or no workflow', async () => {
    const sessionId = featureDevActive();
    const generic: Array<ClassificationResult['workflow']> = [
      'documentation-update',
      'project-question',
      'planning',
    ];
    for (const workflow of generic) {
      const result = await runPromptRouteSeam(
        {
          projectRoot: root,
          request: 'run the review stage',
          sessionId: SESSION,
          adapter: ADAPTER,
        },
        { classify: async () => classificationWith(workflow) },
      );
      expect(result.routed, workflow).toBe('feature-development');
    }
    expect(readWorkflowState(root, sessionId).paused).toEqual([]);
  });

  it("another session's open bundle never keeps this session on feature-development", async () => {
    const other = resolveSessionId(root, 'sess-someone-else');
    openFeatureChange(root, other, { adapter: ADAPTER, title: 'their change', issue: '669' });
    writeWorkflowState(root, other, {
      active: { workflow: 'feature-development', lane: 'full' },
      paused: [],
    });

    expect((await route('run documentation_sync')).routed).toBe('documentation-update');
  });

  it('AC-11: with an open change an unrelated question still detours', async () => {
    const sessionId = featureDevActive();

    const result = await route('what does this project do');

    expect(result.routed).toBe('project-question');
    const state = readWorkflowState(root, sessionId);
    expect(state.active?.workflow).toBe('project-question');
    expect(state.paused).toMatchObject([{ workflow: 'feature-development', lane: 'full' }]);
  });
});
