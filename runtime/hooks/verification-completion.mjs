#!/usr/bin/env node

import process from 'node:process';

import { sessionIdFromStdin } from './lib/context-seam-emit.mjs';
import {
  hookStandsDown,
  isPaqadDisabled,
  parseHookPayload,
  resolveProjectRoot,
} from './lib/paqad-disabled.mjs';
import { stopHookActiveFromStdin } from './lib/loop-guard.mjs';
import { resolveCompletionTranscriptText } from './lib/transcript.mjs';
import { runVerificationBackstop } from '../scripts/verify-backstop.mjs';
import { refreshHudFromHook } from './lib/hud-snapshot.mjs';
import { refreshCostFromHook } from './lib/cost-refresh.mjs';

const ADAPTER = process.argv[2] || undefined;

let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  void main();
});
process.stdin.resume();

async function main() {
  const projectRoot = resolveProjectRoot(process.env, parseHookPayload(input));

  if (hookStandsDown(parseHookPayload(input))) {
    process.exit(0);
    return;
  }

  const deferral = isPaqadDisabled(projectRoot)
    ? null
    : await deferredForBackgroundStage(projectRoot);
  if (deferral?.deferred) {
    if (deferral.nextStage && !stopHookActiveFromStdin(input)) {
      process.stdout.write(
        `${JSON.stringify({ decision: 'block', reason: nextStageNudge(deferral.nextStage) })}\n`,
      );
    }
    process.exit(0);
    return;
  }

  const transcriptText = resolveCompletionTranscriptText(input, ADAPTER) || null;
  const code = await runVerificationBackstop({
    origin: 'hook-completion',
    softFail: true,
    projectRoot,
    hostSessionId: sessionIdFromStdin(input),
    loopActive: stopHookActiveFromStdin(input),
    transcriptText,
  });
  await refreshCostFromHook(input, 'verification-completion');
  await refreshHudFromHook(input, 'verification-completion');
  process.exit(code);
}

function nextStageNudge(stage) {
  return `paqad: the last stage of this change ended and ${stage.replace(/_/g, ' ')} has not started. Start it, or open a decision if the change waits on the person.`;
}

async function deferredForBackgroundStage(projectRoot) {
  const payload = parseHookPayload(input);
  const tasks = payload && Array.isArray(payload.background_tasks) ? payload.background_tasks : [];
  try {
    const distUrl = new URL('../../dist/stage-evidence/completion-deferred.js', import.meta.url);
    const { deferCompletionForBackgroundStage } = await import(distUrl.href);
    return deferCompletionForBackgroundStage({
      projectRoot,
      backgroundTasks: tasks,
      sessionId: sessionIdFromStdin(input),
      adapter: ADAPTER ?? 'claude-code',
    });
  } catch {
    return null;
  }
}
