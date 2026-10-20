#!/usr/bin/env node

import process from 'node:process';

import {
  appendHooksLog,
  hookStandsDown,
  isPaqadDisabled,
  parseHookPayload,
  resolveProjectRoot,
} from './lib/paqad-disabled.mjs';
import {
  resolveCompletionTranscriptText,
  resolveSubagentTranscriptText,
} from './lib/transcript.mjs';
import { refreshHudFromHook } from './lib/hud-snapshot.mjs';
import { refreshCostFromHook } from './lib/cost-refresh.mjs';

const ADAPTER = process.argv[2] || 'claude-code';

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

    const transcriptText = resolveCompletionTranscriptText(input, ADAPTER) || '';

    const recorderUrl = new URL(
      '../../dist/stage-isolation/subagent-completion.js',
      import.meta.url,
    );
    const { recordStageAgentCompletion, recordHighTableUsage } = await import(recorderUrl.href);
    recordStageAgentCompletion({ projectRoot, payload, transcriptText, adapter: ADAPTER });

    try {
      recordHighTableUsage({ projectRoot, payload });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendHooksLog(
        projectRoot,
        `stage-agent-completion: high-table usage not recorded: ${message}`,
      );
    }

    const agentText = resolveSubagentTranscriptText(input, ADAPTER) || '';
    if (agentText) {
      try {
        const markerUrl = new URL('../../dist/stage-evidence/marker-parse.js', import.meta.url);
        const { parseAndRecordMarkers } = await import(markerUrl.href);
        parseAndRecordMarkers({
          projectRoot,
          transcriptText: agentText,
          sessionId: markerSessionId(payload),
          keepSessionCache: true,
          adapter: ADAPTER,
        });
      } catch {
        /* v8 ignore next */
      }
    }
    return 0;
  } catch {
    /* v8 ignore next */
    return 0;
  }
}

function markerSessionId(payload) {
  for (const candidate of [
    payload?.session_id,
    process.env.SE_SESSION,
    process.env.CLAUDE_SESSION_ID,
  ]) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim();
  }
  return null;
}

let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  main(input).then(async (code) => {
    await refreshCostFromHook(input, 'stage-agent-completion');
    await refreshHudFromHook(input, 'stage-agent-completion');
    process.exit(code);
  });
});
process.stdin.resume();
