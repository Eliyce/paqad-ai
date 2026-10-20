#!/usr/bin/env node
// stage-agent-completion.mjs — records a stage agent's `stage-agent` row on SubagentStop
// (issues #567, #581).
//
// A subagent-completion hook, wired only when stage isolation is on and matched to paqad's
// own stage agents (`^paqad-` on agent type). When a stage agent finishes it reads the
// subagent transcript, appends one `kind: 'stage-agent'` row to the bundle's
// stage-evidence.jsonl (tokens used + carried history the orchestrator did not re-send), and — belt and braces — records any
// `paqad:stage` markers the agent spoke (the CLI verbs already recorded the authoritative
// rows). Non-blocking and best-effort: always exits 0. Blocking a SubagentStop is
// undocumented on Claude, so this hook never does.
//
// Thin by contract (logic lives in dist/): drain stdin → resolve transcript → lazy-import →
// record → exit 0.

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

// The host that invoked the hook (issue #566 argv convention): `claude-code` (default) or
// `codex-cli`.
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

    // Issue #639 (Part 13): a High Table seat (paqad-expert, paqad-chief-architect) is not a
    // stage, so the recorder above writes nothing for it. Its exact tokens are read from its own
    // transcript (agent_transcript_path) into high-table.jsonl. Wrapped on its own: a failure is
    // logged to .paqad/logs/hooks.log and never changes this hook's exit code or output.
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
  // Issue #639 (Part 7) — refresh the HUD snapshot once the decision is final.
  main(input).then(async (code) => {
    // Issue #639 (Part 23): rewrite the change's cost.json (record-only, logs its own failure),
    // then refresh the HUD snapshot so it carries the new cost.
    await refreshCostFromHook(input, 'stage-agent-completion');
    await refreshHudFromHook(input, 'stage-agent-completion');
    process.exit(code);
  });
});
process.stdin.resume();
