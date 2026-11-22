#!/usr/bin/env node

import process from 'node:process';

import { sessionIdFromStdin } from './lib/context-seam-emit.mjs';
import {
  hookStandsDown,
  onboardingJourneyExists,
  isPaqadDisabled,
  parseHookPayload,
  resolveProjectRoot,
} from './lib/paqad-disabled.mjs';
import { stopHookActiveFromStdin } from './lib/loop-guard.mjs';
import { resolveCompletionTranscriptText } from './lib/transcript.mjs';
import { loadPaqadApi, runVerificationBackstop } from '../scripts/verify-backstop.mjs';
import { logHookDebug, logHookFailure } from './lib/hook-log.mjs';
import { checkVerdictAgreement } from './lib/verdict-agreement.mjs';
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
    if (onboardingJourneyExists(projectRoot)) await nudgeOnboarding(projectRoot);
    process.exit(0);
    return;
  }

  if (!isPaqadDisabled(projectRoot) && (await nudgeOnboarding(projectRoot))) {
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
  const held = [];
  const code = await runVerificationBackstop({
    origin: 'hook-completion',
    softFail: true,
    projectRoot,
    hostSessionId: sessionIdFromStdin(input),
    loopActive: stopHookActiveFromStdin(input),
    transcriptText,
    stdout: { write: (chunk) => held.push(String(chunk)) },
  });
  const agreement =
    held.length === 0 && !isPaqadDisabled(projectRoot) ? await verdictAgreement(projectRoot) : null;
  if (agreement) held.push(`${JSON.stringify(agreement)}\n`);
  const stopped = stoppedSlicesBlock(deferral, held.length === 0);
  if (stopped) held.push(`${JSON.stringify(stopped)}\n`);
  for (const chunk of held) process.stdout.write(chunk);
  await refreshCostFromHook(input, 'verification-completion');
  await refreshHudFromHook(input, 'verification-completion');
  process.exit(code);
}

async function verdictAgreement(projectRoot) {
  try {
    const api = await loadPaqadApi();
    return checkVerdictAgreement({
      api,
      projectRoot,
      stdin: input,
      hostSessionId: sessionIdFromStdin(input),
      loopActive: stopHookActiveFromStdin(input),
      log: (note) => logHookDebug(projectRoot, 'verification-completion:verdict', note),
    });
  } catch (error) {
    logHookFailure(projectRoot, 'verification-completion:verdict', error);
    return null;
  }
}

function stoppedSlicesBlock(deferral, nothingHeld) {
  const note = typeof deferral?.stoppedSlicesNote === 'string' ? deferral.stoppedSlicesNote : '';
  if (note === '' || !nothingHeld || stopHookActiveFromStdin(input)) return null;
  return { decision: 'block', reason: note };
}

function nextStageNudge(stage) {
  return `paqad: the last stage of this change ended and ${stage.replace(/_/g, ' ')} has not started. Start it, or open a decision if the change waits on the person.`;
}

async function nudgeOnboarding(projectRoot) {
  if (stopHookActiveFromStdin(input)) return false;
  try {
    const url = new URL('../../dist/stage-evidence/completion-deferred.js', import.meta.url);
    const { onboardingStopNudge } = await import(url.href);
    const nudge = onboardingStopNudge(projectRoot, sessionIdFromStdin(input));
    if (!nudge) return false;
    process.stdout.write(`${JSON.stringify({ decision: 'block', reason: nudge })}\n`);
    return true;
  } catch (error) {
    logHookFailure(projectRoot, 'verification-completion:onboarding', error);
    return false;
  }
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
