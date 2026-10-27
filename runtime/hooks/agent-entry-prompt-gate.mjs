#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  ENABLEMENT_VERIFIED_LINE,
  loadSteps,
  specPipelineNudge,
} from './lib/agent-entry-directive.mjs';
import { entryFile, sentinelRelative, sentinelState } from './lib/agent-entry-sentinel.mjs';
import { fitHookOutput } from '../scripts/context-seam.mjs';
import { emitContext, sessionIdFromStdin } from './lib/context-seam-emit.mjs';
import { logHookFailure } from './lib/hook-log.mjs';
import {
  hookStandsDown,
  isPaqadDisabled,
  parseHookPayload,
  readLayeredKey,
  resolveProjectRoot,
} from './lib/paqad-disabled.mjs';
import { quietNarration } from './lib/hud-heartbeat.mjs';
import { refreshHudFromHook } from './lib/hud-snapshot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const ADAPTER = process.argv[2] || undefined;

const TASK_LIST_SENTENCES = {
  full: 'paqad task list: Plan, Spec, Load rules, Build, Review, Checks, Docs. Start each item with that word, in this order. Items before Plan (read the ticket) and after Docs (open the PR) are fine.',
  fast: 'paqad task list: Plan, Build, Checks. Start each item with that word, in this order. Items before Plan and after Checks are fine.',
};

function taskListSentence(lane) {
  return lane === 'fast' ? TASK_LIST_SENTENCES.fast : TASK_LIST_SENTENCES.full;
}

function reasonFor(state, ef, sentinelRel) {
  switch (state) {
    case 'missing':
      return `the per-session sentinel ${sentinelRel} is missing`;
    case 'stale:entry-file':
      return `${ef} changed mid-session — the sentinel was invalidated`;
    case 'stale:framework-path':
      return '.paqad/framework-path.txt changed mid-session — the sentinel was invalidated';
    case 'stale:docs-instructions':
      return 'docs/instructions/ changed mid-session — the sentinel was invalidated';
    default:
      return `the sentinel is not fresh (${state})`;
  }
}

function directive(state, ef, sentinelRel) {
  return [
    ENABLEMENT_VERIFIED_LINE,
    '[paqad] You MUST load the paqad framework before responding.',
    `[paqad] Reason: ${reasonFor(state, ef, sentinelRel)}.`,
    '[paqad] Required steps, in order, before any other tool call or response:',
    ...loadSteps(ef, sentinelRel),
    '[paqad] Only after the final step may you address the prompt.',
    '',
  ].join('\n');
}

function emitInjection(text) {
  if (!text) {
    return;
  }
  if (ADAPTER === 'codex-cli') {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text },
      })}\n`,
    );
    return;
  }
  process.stdout.write(text);
}

function fireContextRefresh(sessionId) {
  try {
    const refresh = join(HERE, 'context-refresh-trigger.mjs');
    const args = sessionId ? [refresh, sessionId] : [refresh];
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {}
}

async function isHumanPrompt(stdin, projectRoot) {
  try {
    const parsed = JSON.parse(stdin);
    const prompt = typeof parsed?.prompt === 'string' ? parsed.prompt : '';
    if (!prompt.trim()) {
      return false;
    }
    const laneUrl = new URL('../../dist/pipeline/prompt-lane.js', import.meta.url);
    const { isSystemNotificationPrompt } = await import(laneUrl.href);
    return !isSystemNotificationPrompt(prompt);
  } catch (error) {
    logHookFailure(projectRoot, 'agent-entry-prompt-gate', error, 'checking the prompt is human');
    return false;
  }
}

async function refreshForHumanPrompt(stdin, projectRoot, sessionId) {
  if (await isHumanPrompt(stdin, projectRoot)) {
    fireContextRefresh(sessionId);
  }
}

async function emitRoute(stdin, projectRoot, sink) {
  try {
    const parsed = JSON.parse(stdin);
    const request = typeof parsed?.prompt === 'string' ? parsed.prompt : '';
    if (!request.trim()) {
      return null;
    }
    const sessionId = typeof parsed?.session_id === 'string' ? parsed.session_id : null;
    const distUrl = new URL('../../dist/pipeline/prompt-lane.js', import.meta.url);
    const { runPromptRouteSeam } = await import(distUrl.href);
    const { routed, lane, narration, notification } = await runPromptRouteSeam({
      projectRoot,
      request,
      sessionId,
      adapter: ADAPTER ?? 'claude-code',
    });
    if (notification) {
      return null;
    }
    if (narration) {
      sink(`${narration}\n`);
    }
    if (routed === 'feature-development' && sessionId) {
      sink(`[paqad] session ${sessionId}: prefix paqad-ai commands with SE_SESSION=${sessionId}\n`);
    }
    if (routed === 'feature-development') {
      sink(`${taskListSentence(lane ?? null)}\n`);
    }
    return { routed, lane: lane ?? null };
  } catch (error) {
    logHookFailure(projectRoot, 'agent-entry-prompt-gate', error, 'routing this prompt');
    return null;
  }
}

async function main(stdin) {
  const projectRoot = resolveProjectRoot(process.env, parseHookPayload(stdin));

  if (isPaqadDisabled(projectRoot) || hookStandsDown(parseHookPayload(stdin))) {
    return 0;
  }

  const sessionId = sessionIdFromStdin(stdin);
  const state = sentinelState(projectRoot, process.env, undefined, sessionId);
  if (state !== 'fresh') {
    await emitRoute(stdin, projectRoot, () => {});
    await refreshForHumanPrompt(stdin, projectRoot, sessionId);
    const message = directive(state, entryFile(), sentinelRelative(sessionId));
    if ((process.env.PAQAD_AGENT_ENTRY_MODE || 'soft') === 'hard') {
      process.stderr.write(message);
      return 2;
    }
    emitInjection(message);
    return 0;
  }

  let routeBuf = '';
  const route = await emitRoute(stdin, projectRoot, (text) => (routeBuf += text));
  await refreshForHumanPrompt(stdin, projectRoot, sessionId);
  const routed = route?.routed ?? null;
  const stripRules = typeof routed === 'string' && routed !== 'feature-development';
  let contextBuf = '';
  emitContext(stdin, projectRoot, (text) => (contextBuf += text), { stripRules });
  const nudge = specPipelineNudge(readLayeredKey, projectRoot, process.env, route);
  const after = `${nudge ? `${nudge}\n` : ''}${quietNarration(projectRoot, sessionId, ADAPTER)}`;
  emitInjection(fitHookOutput(routeBuf, contextBuf, after));
  return 0;
}

let done = false;
const chunks = [];
const run = () => {
  if (done) return;
  done = true;
  const text = Buffer.concat(chunks).toString('utf8');
  main(text)
    .then(async (code) => {
      await refreshHudFromHook(text, 'agent-entry-prompt-gate');
      process.exit(code);
    })
    .catch(() => process.exit(0));
};

process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', run);
process.stdin.on('error', run);
process.stdin.resume();
