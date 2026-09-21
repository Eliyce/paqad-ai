#!/usr/bin/env node
// stage-agent-completion.mjs — records a stage agent's context-efficiency row on
// SubagentStop (issue #567).
//
// A subagent-completion hook, wired only when stage isolation is on and matched to paqad's
// own stage agents (`^paqad-` on agent type). When a stage agent finishes it reads the
// subagent transcript, appends one `context-efficiency.jsonl` row (tokens used + carried
// history the orchestrator did not re-send), and — belt and braces — records any
// `paqad:stage` markers the agent spoke (the CLI verbs already recorded the authoritative
// rows). Non-blocking and best-effort: always exits 0. Blocking a SubagentStop is
// undocumented on Claude, so this hook never does.
//
// Thin by contract (logic lives in dist/): drain stdin → resolve transcript → lazy-import →
// record → exit 0.

import process from 'node:process';

import { isPaqadDisabled, resolveProjectRoot } from './lib/paqad-disabled.mjs';
import { resolveCompletionTranscriptText } from './lib/transcript.mjs';

// The host that invoked the hook (issue #566 argv convention): `claude-code` (default) or
// `codex-cli`.
const ADAPTER = process.argv[2] || 'claude-code';

async function main(input) {
  try {
    const projectRoot = resolveProjectRoot();
    if (isPaqadDisabled(projectRoot)) return 0;

    let payload;
    try {
      payload = JSON.parse(input);
    } catch {
      /* v8 ignore next */
      return 0;
    }

    const transcriptText = resolveCompletionTranscriptText(input, ADAPTER) || '';

    const recorderUrl = new URL('../../dist/stage-isolation/subagent-completion.js', import.meta.url);
    const { recordStageAgentCompletion } = await import(recorderUrl.href);
    recordStageAgentCompletion({ projectRoot, payload, transcriptText, adapter: ADAPTER });

    // Belt and braces: record any paqad:stage markers the stage agent spoke in its own
    // transcript. The stage CLI verbs already wrote the authoritative rows under the
    // orchestrator's session id, so this only backfills a marker the agent narrated.
    if (transcriptText) {
      try {
        const markerUrl = new URL('../../dist/stage-evidence/marker-parse.js', import.meta.url);
        const { parseAndRecordMarkers } = await import(markerUrl.href);
        parseAndRecordMarkers({
          projectRoot,
          transcriptText,
          sessionId: payload?.session_id ?? null,
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

let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  main(input).then((code) => process.exit(code));
});
process.stdin.resume();
