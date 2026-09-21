#!/usr/bin/env node
// stage-marker-parse.mjs — records the non-mutation stage markers (RCA fix, Step 3;
// issue #566 Codex parity).
//
// A completion (Stop) hook, ordered BEFORE verification-completion so the markers are
// in the ledger when the completion backstop folds the change. It reads the turn
// transcript (a readable `transcript_path`, or on Codex the session rollout jsonl when
// the path is absent), extracts the agent's `paqad:stage <stage> <start|end>` control
// lines, and records each through the script-minting recorder verbs, attributed to the
// host that ran. Non-blocking and best-effort: always exits 0.
//
// Thin by contract (parse logic lives in dist/stage-evidence/marker-parse.js): drain
// stdin → resolve transcript → lazy-import → record → exit 0.

import process from 'node:process';

import { isPaqadDisabled, resolveProjectRoot } from './lib/paqad-disabled.mjs';
import { resolveCompletionTranscriptText } from './lib/transcript.mjs';

// The host that invoked the hook (issue #566): `claude-code` (default) or `codex-cli`.
const ADAPTER = process.argv[2] || undefined;

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
    const transcriptText = resolveCompletionTranscriptText(input, ADAPTER);
    if (!transcriptText) return 0;

    const distUrl = new URL('../../dist/stage-evidence/marker-parse.js', import.meta.url);
    const { parseAndRecordMarkers } = await import(distUrl.href);
    // Record every parsed marker to the ledger (issue #307 — the ledger write is
    // non-negotiable), attributed to the host that ran (issue #566). The chat echo that
    // used to ride `{systemMessage}` is gone: Claude Code RENDERS a Stop-hook
    // `{systemMessage}` on Desktop as literal "Stop says:" lines, so echoing here
    // duplicated the stage lines the agent already speaks itself (issue #409).
    parseAndRecordMarkers({
      projectRoot,
      transcriptText,
      sessionId: payload?.session_id ?? null,
      adapter: ADAPTER,
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
  main(input).then((code) => process.exit(code));
});
process.stdin.resume();
