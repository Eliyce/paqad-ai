#!/usr/bin/env node

import process from 'node:process';

import { isDirectEntry } from './lib/direct-entry.mjs';
import {
  appendHooksLog,
  hookStandsDown,
  isPaqadDisabled,
  parseHookPayload,
  resolveProjectRoot,
} from './lib/paqad-disabled.mjs';

const PAQAD_AGENT = /^(?:paqad:)?paqad-/;

export async function main(input) {
  const payload = parseHookPayload(input);
  const agentType = typeof payload?.agent_type === 'string' ? payload.agent_type.trim() : '';
  if (!PAQAD_AGENT.test(agentType)) return 0;
  let projectRoot;
  try {
    projectRoot = resolveProjectRoot(process.env, payload);
    if (isPaqadDisabled(projectRoot) || hookStandsDown(payload)) return 0;
    const distUrl = new URL('../../dist/stage-isolation/bash-write-guard.js', import.meta.url);
    const { formatStageAgentWriteSummary, stageAgentWriteDecision } = await import(distUrl.href);
    const decision = stageAgentWriteDecision({
      projectRoot,
      agentType,
      toolName: payload?.tool_name,
      command: payload?.tool_input?.command,
      cwd: typeof payload?.cwd === 'string' && payload.cwd.trim() !== '' ? payload.cwd : undefined,
    });
    if (!decision.blocked) return 0;
    appendHooksLog(
      projectRoot,
      `stage-agent-write-guard: blocked agent=${decision.agent} target=${decision.target ?? 'unresolved'}`,
    );
    process.stderr.write(`${formatStageAgentWriteSummary(decision)}\n`);
    return 2;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
      if (projectRoot)
        appendHooksLog(projectRoot, `stage-agent-write-guard: failed closed: ${reason}`);
    } catch {}
    process.stderr.write(
      `[paqad] write check for ${agentType} could not run (${reason}), so the command is blocked.\n`,
    );
    return 2;
  }
}

if (isDirectEntry(import.meta.url)) {
  let input = '';
  process.stdin.on('data', (chunk) => {
    input += chunk;
  });
  process.stdin.on('end', () => {
    main(input).then((code) => process.exit(code));
  });
  process.stdin.resume();
}
