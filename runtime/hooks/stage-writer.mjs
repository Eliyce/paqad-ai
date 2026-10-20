#!/usr/bin/env node

import process from 'node:process';

import { editTargets } from './lib/edit-targets.mjs';
import {
  hookStandsDown,
  isPaqadDisabled,
  parseHookPayload,
  resolveProjectRoot,
} from './lib/paqad-disabled.mjs';
import { refreshHudFromHook } from './lib/hud-snapshot.mjs';

const ADAPTER_TYPE = process.argv[2] || undefined;

async function main(input) {
  try {
    const projectRoot = resolveProjectRoot(process.env, parseHookPayload(input));
    if (isPaqadDisabled(projectRoot) || hookStandsDown(parseHookPayload(input))) return 0;

    let payload;
    try {
      payload = JSON.parse(input);
    } catch {
      /* v8 ignore next */
      return 0;
    }
    const toolName = payload?.tool_name;
    const targetPaths = editTargets(payload);
    if (!toolName || targetPaths.length === 0) return 0;
    const sessionId = payload?.session_id ?? null;
    const agentType = typeof payload?.agent_type === 'string' ? payload.agent_type : undefined;
    const agentId = typeof payload?.agent_id === 'string' ? payload.agent_id : undefined;

    const liveUrl = new URL('../../dist/stage-evidence/live-writer.js', import.meta.url);
    const { recordLiveStageEdits, resolveAgentIdentity } = await import(liveUrl.href);

    recordLiveStageEdits({
      projectRoot,
      sessionId,
      toolName,
      targetPaths,
      adapter: ADAPTER_TYPE,
      agent: resolveAgentIdentity({ agentType, agentId }),
    });
    return 0;
  } catch {
    /* v8 ignore next */
    return 0;
  }
}

let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  main(input).then(async (code) => {
    await refreshHudFromHook(input, 'stage-writer');
    process.exit(code);
  });
});
process.stdin.resume();
