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

  if (!isPaqadDisabled(projectRoot) && (await deferredForBackgroundStage(projectRoot))) {
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

async function deferredForBackgroundStage(projectRoot) {
  const payload = parseHookPayload(input);
  // An empty or missing list never means no stage agent runs: the deferral also reads the
  // change's ledger (a started stage agent with no stop) and the checks running marker.
  const tasks = payload && Array.isArray(payload.background_tasks) ? payload.background_tasks : [];
  try {
    const distUrl = new URL('../../dist/stage-evidence/completion-deferred.js', import.meta.url);
    const { deferCompletionForBackgroundStage } = await import(distUrl.href);
    return deferCompletionForBackgroundStage({
      projectRoot,
      backgroundTasks: tasks,
      sessionId: sessionIdFromStdin(input),
      adapter: ADAPTER ?? 'claude-code',
    }).deferred;
  } catch {
    return false;
  }
}
