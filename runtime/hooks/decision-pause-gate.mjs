#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { editTargets } from './lib/edit-targets.mjs';
import { gateFailureMessage } from './lib/gate-failure.mjs';
import {
  hookStandsDown,
  isManagedRoute,
  isPaqadDisabled,
  parseHookPayload,
  resolveProjectRoot,
} from './lib/paqad-disabled.mjs';

const UNRESOLVED = Symbol('unresolved');

function pendingDir(projectRoot) {
  return join(projectRoot, '.paqad', 'decisions', 'pending');
}

function pendingPacketIds(projectRoot) {
  try {
    return readdirSync(pendingDir(projectRoot))
      .filter((name) => /^D-.*\.json$/.test(name))
      .map((name) => name.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}

function packetFields(projectRoot, id) {
  try {
    const packet = JSON.parse(readFileSync(join(pendingDir(projectRoot), `${id}.json`), 'utf8'));
    const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value : null);
    return { change: text(packet?.change), workstream: text(packet?.workstream) };
  } catch {
    return { change: null, workstream: null };
  }
}

async function sliceScoped(projectRoot, payload, packets, loadResolver) {
  if (!packets.some((packet) => packet.workstream !== null)) return packets.map((p) => p.id);
  try {
    const { scopedPacketsBlocking } = await loadResolver();
    if (typeof scopedPacketsBlocking !== 'function') return packets.map((p) => p.id);
    const hint = typeof payload?.session_id === 'string' ? payload.session_id : null;
    const sessionId = hint ?? process.env.SE_SESSION ?? null;
    if (!sessionId) return packets.map((p) => p.id);
    return scopedPacketsBlocking({
      projectRoot,
      sessionId,
      packets: packets.map((p) => ({ id: p.id, workstream: p.workstream })),
      targets: editTargets(payload),
    });
  } catch {
    return packets.map((p) => p.id);
  }
}

async function loadDistResolver() {
  const liveUrl = new URL('../../dist/stage-evidence/live-writer.js', import.meta.url);
  return import(liveUrl.href);
}

async function activeChangeFor(projectRoot, payload, loadResolver) {
  try {
    const { peekActiveChangeKey } = await loadResolver();
    if (typeof peekActiveChangeKey !== 'function') return UNRESOLVED;
    const hint = typeof payload?.session_id === 'string' ? payload.session_id : null;
    const key = peekActiveChangeKey(projectRoot, hint);
    return typeof key === 'string' && key !== '' ? key : UNRESOLVED;
  } catch {
    return UNRESOLVED;
  }
}

export async function evaluateDecisionPauseGate(input, { loadResolver = loadDistResolver } = {}) {
  const payload = parseHookPayload(input);
  const projectRoot = resolveProjectRoot(process.env, payload);

  if (!isManagedRoute(process.env) && (isPaqadDisabled(projectRoot) || hookStandsDown(payload))) {
    return 0;
  }

  const ids = pendingPacketIds(projectRoot);
  if (ids.length === 0) {
    return 0;
  }

  const packets = ids.map((id) => ({ id, ...packetFields(projectRoot, id) }));
  const scoped = packets.some((packet) => packet.change !== null);
  const active = scoped ? await activeChangeFor(projectRoot, payload, loadResolver) : UNRESOLVED;
  const inChange = packets.filter(
    (packet) => packet.change === null || active === UNRESOLVED || packet.change === active,
  );
  const stillBlocking = new Set(await sliceScoped(projectRoot, payload, inChange, loadResolver));
  const blocking = inChange.filter((packet) => stillBlocking.has(packet.id));
  if (blocking.length === 0) {
    return 0;
  }

  process.stderr.write(
    [
      '[paqad] Blocked: a decision pause is open. Resolve it before editing.',
      `[paqad] Pending decision packet(s): ${blocking.map((packet) => packet.id).join(', ')}`,
      '[paqad] Answer the packet (AskUserQuestion / decision UI), then continue.',
      '',
    ].join('\n'),
  );
  return 2;
}

export async function main(input, options) {
  try {
    return await evaluateDecisionPauseGate(input, options);
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
  void main(input).then((code) => process.exit(code));
});
process.stdin.on('error', () => {
  void main(input).then((code) => process.exit(code));
});
process.stdin.resume();
