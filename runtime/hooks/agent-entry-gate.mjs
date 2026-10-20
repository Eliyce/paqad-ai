#!/usr/bin/env node

import process from 'node:process';

import { isDirectEntry } from './lib/direct-entry.mjs';

import { ENABLEMENT_VERIFIED_LINE, loadSteps } from './lib/agent-entry-directive.mjs';
import { editTargets } from './lib/edit-targets.mjs';
import {
  agentEntryMarkerRelative,
  entryFile,
  sentinelRelative,
  sentinelState,
  stampAgentEntryMarker,
  stampSessionSentinel,
} from './lib/agent-entry-sentinel.mjs';
import { agentIdFromStdin, sessionIdFromStdin } from './lib/context-seam-emit.mjs';
import { gateFailureMessage } from './lib/gate-failure.mjs';
import {
  hookStandsDown,
  isPaqadDisabled,
  parseHookPayload,
  resolveProjectRoot,
} from './lib/paqad-disabled.mjs';

export function isSentinelWrite(input) {
  try {
    const payload = JSON.parse(input);
    return editTargets(payload).some((target) => {
      const norm = target.replace(/\\/g, '/');
      return (
        norm.endsWith('.paqad/.agent-entry-loaded') ||
        /(^|\/)\.paqad\/\.agent-entry-loaded\.d\/[^/]+$/.test(norm) ||
        norm.includes('/.paqad/session/agent-entry/')
      );
    });
  } catch {
    return false;
  }
}

function evaluateEntryGate(input) {
  const projectRoot = resolveProjectRoot(process.env, parseHookPayload(input));

  if (isPaqadDisabled(projectRoot) || hookStandsDown(parseHookPayload(input))) {
    return 0;
  }

  const agentId = agentIdFromStdin(input);
  const sessionId = sessionIdFromStdin(input);

  if (sentinelState(projectRoot, process.env, agentId, sessionId) === 'fresh') {
    return 0;
  }

  if (isSentinelWrite(input)) {
    if (agentId) {
      stampAgentEntryMarker(projectRoot, agentId);
    } else if (sessionId) {
      stampSessionSentinel(projectRoot, sessionId, entryFile());
    }
    return 0;
  }

  const ef = entryFile();
  const markerRel = agentId ? agentEntryMarkerRelative(agentId) : null;
  const sentinelRel = agentId ? sentinelRelative(undefined) : sentinelRelative(sessionId);
  const subagentLine = markerRel
    ? [
        `[paqad] You are a paqad stage subagent. After loading, record THIS agent's own load by ` +
          `creating ${markerRel} (Write it, or \`mkdir -p .paqad/session/agent-entry && touch ${markerRel}\`); ` +
          'then retry your edit. Writing .paqad/.agent-entry-loaded with the Write tool clears it too.',
      ]
    : [];
  process.stderr.write(
    [
      '[paqad] Blocked: load the paqad framework before editing.',
      ENABLEMENT_VERIFIED_LINE,
      '[paqad] Required steps:',
      ...loadSteps(ef, sentinelRel),
      ...subagentLine,
      '',
    ].join('\n'),
  );
  return 2;
}

export function main(input) {
  try {
    return evaluateEntryGate(input);
  } catch (error) {
    process.stderr.write(`${gateFailureMessage('agent-entry', error)}\n`);
    return 2;
  }
}

if (isDirectEntry(import.meta.url)) {
  let input = '';
  process.stdin.on('data', (chunk) => {
    input += chunk;
  });
  process.stdin.on('end', () => {
    process.exit(main(input));
  });
  process.stdin.resume();
}
