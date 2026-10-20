#!/usr/bin/env node

import process from 'node:process';

import { logHookFailure } from './lib/hook-log.mjs';
import {
  hookStandsDown,
  isPaqadDisabled,
  parseHookPayload,
  resolveProjectRoot,
} from './lib/paqad-disabled.mjs';

async function main(rawInput) {
  const projectRoot = resolveProjectRoot(process.env, parseHookPayload(rawInput));
  if (isPaqadDisabled(projectRoot) || hookStandsDown(parseHookPayload(rawInput))) return 0;

  let payload;
  try {
    payload = JSON.parse(rawInput);
  } catch {
    return 0;
  }
  const prompt = typeof payload?.prompt === 'string' ? payload.prompt : '';
  if (!prompt) return 0;

  if (prompt.trimStart().startsWith('/')) return 0;

  let refs = [];
  try {
    const laneUrl = new URL('../../dist/pipeline/prompt-lane.js', import.meta.url);
    const { isSystemNotificationPrompt } = await import(laneUrl.href);
    if (isSystemNotificationPrompt(prompt)) return 0;

    const distUrl = new URL('../../dist/planning/ticket-ref-detect.js', import.meta.url);
    const { detectTicketRefs, armIntakeNarration } = await import(distUrl.href);
    refs = detectTicketRefs(prompt, 'generic');
    const line = armIntakeNarration(refs);
    if (line) process.stdout.write(line + '\n');
  } catch (error) {
    logHookFailure(projectRoot, 'ticket-intake-prompt', error, 'detecting ticket refs');
  }
  if (refs.length > 0) await writeBranchLine(projectRoot, refs);
  return 0;
}

async function writeBranchLine(projectRoot, refs) {
  try {
    const splitUrl = new URL('../../dist/delivery/commit-split.js', import.meta.url);
    const { intakeBranchLine } = await import(splitUrl.href);
    const line = intakeBranchLine(projectRoot, refs);
    if (line) process.stdout.write(line + '\n');
  } catch (error) {
    logHookFailure(projectRoot, 'ticket-intake-prompt', error, 'reading the branch commits');
  }
}

let done = false;
const chunks = [];
const run = () => {
  if (done) return;
  done = true;
  main(Buffer.concat(chunks).toString('utf8'))
    .then((code) => process.exit(code))
    .catch(() => process.exit(0));
};

process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', run);
process.stdin.on('error', run);
process.stdin.resume();
