#!/usr/bin/env node

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { gateFailureMessage } from './lib/gate-failure.mjs';
import {
  hookStandsDown,
  isPaqadDisabled,
  parseHookPayload,
  resolveProjectRoot,
} from './lib/paqad-disabled.mjs';

function pendingPacketIds(projectRoot) {
  try {
    return readdirSync(join(projectRoot, '.paqad', 'decisions', 'pending'))
      .filter((name) => /^D-.*\.json$/.test(name))
      .map((name) => name.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}

function evaluateDecisionPauseGate(input) {
  const projectRoot = resolveProjectRoot(process.env, parseHookPayload(input));

  if (isPaqadDisabled(projectRoot) || hookStandsDown(parseHookPayload(input))) {
    return 0;
  }

  const ids = pendingPacketIds(projectRoot);
  if (ids.length === 0) {
    return 0;
  }

  process.stderr.write(
    [
      '[paqad] Blocked: a decision pause is open. Resolve it before editing.',
      `[paqad] Pending decision packet(s): ${ids.join(', ')}`,
      '[paqad] Answer the packet (AskUserQuestion / decision UI), then continue.',
      '',
    ].join('\n'),
  );
  return 2;
}

export function main(input) {
  try {
    return evaluateDecisionPauseGate(input);
  } catch (error) {
    process.stderr.write(`${gateFailureMessage('decision-pause', error)}\n`);
    return 2;
  }
}

let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  process.exit(main(input));
});
process.stdin.on('error', () => {
  process.exit(main(input));
});
process.stdin.resume();
