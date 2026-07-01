#!/usr/bin/env node
// stage-marker-parse.mjs — records the non-mutation stage markers (RCA fix, Step 3).
//
// A Stop hook, ordered BEFORE verification-completion so the markers are in the
// ledger when the completion backstop folds the change. It reads the turn
// transcript (Claude Stop payload `transcript_path`), extracts the agent's
// `paqad:stage <stage> <start|end>` control lines, and records each through the
// script-minting recorder verbs. Non-blocking and best-effort: always exits 0.
//
// Thin by contract (parse logic lives in dist/stage-evidence/marker-parse.js):
// drain stdin → parse payload → lazy-import → record → exit 0. Claude-only.

import { readFileSync } from 'node:fs';
import process from 'node:process';

import { isPaqadDisabled, resolveProjectRoot } from './lib/paqad-disabled.mjs';

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
    const transcriptPath = payload?.transcript_path ?? null;
    if (!transcriptPath) return 0;

    let transcriptText;
    try {
      transcriptText = readFileSync(transcriptPath, 'utf8');
    } catch {
      /* v8 ignore next */
      return 0;
    }

    const distUrl = new URL('../../dist/stage-evidence/marker-parse.js', import.meta.url);
    const { parseAndRecordMarkers } = await import(distUrl.href);
    parseAndRecordMarkers({
      projectRoot,
      transcriptText,
      sessionId: payload?.session_id ?? null,
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
