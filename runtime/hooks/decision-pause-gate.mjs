#!/usr/bin/env node
// decision-pause-gate.mjs — PreToolUse hook (cross-platform port of
// decision-pause-gate.sh, #240; issue #117 C-3).
//
// Blocks any code-mutating tool call while an unresolved decision packet exists in
// .paqad/decisions/pending/. The completion/backstop run (verify-backstop.mjs) is
// the second layer — it fails the implementation-review gate when a change lands
// against an unresolved packet, so the contract holds even where this live hook is
// unavailable.
//
// Exit codes:
//   0  → allow the tool call (no pending decision)
//   2  → block the tool call (the host surfaces stderr to the model)

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { gateFailureMessage } from './lib/gate-failure.mjs';
import {
  isPaqadDisabled,
  npmHookStepsAside,
  parseHookPayload,
  pluginStandsDownUnonboarded,
  resolveProjectRoot,
} from './lib/paqad-disabled.mjs';

/** Ids of the pending decision packets (D-*.json) under .paqad/decisions/pending. */
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
  // Issue #615 (Part 1) — resolve the worktree root from the PreToolUse payload's cwd
  // so a worktree session reads the worktree's pending packets, not the main checkout's.
  const projectRoot = resolveProjectRoot(process.env, parseHookPayload(input));

  // Issue #220 — when paqad is disabled (or env-overridden off), the gate is a
  // pure no-op: never block on a pending packet, write nothing.
  if (
    isPaqadDisabled(projectRoot) ||
    npmHookStepsAside(parseHookPayload(input)) ||
    pluginStandsDownUnonboarded(parseHookPayload(input))
  ) {
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

/**
 * The PreToolUse decision-pause gate, failing CLOSED (issue #615, Part 6): an unexpected error
 * blocks the edit (exit 2) with a doctor-pointing message rather than letting it through. The known
 * soft conditions (disabled, no pending packet) still return 0 from inside the body.
 */
export function main(input) {
  try {
    return evaluateDecisionPauseGate(input);
  } catch (error) {
    process.stderr.write(`${gateFailureMessage('decision-pause', error)}\n`);
    return 2;
  }
}

// Drain stdin (the host pipes the PreToolUse payload; its `cwd` locates the worktree,
// issue #615 Part 1) then gate. If stdin is already closed (no pipe), `end` may not fire —
// guard with resume so the process never hangs.
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
