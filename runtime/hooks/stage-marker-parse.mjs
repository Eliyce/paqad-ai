#!/usr/bin/env node

import process from 'node:process';

import {
  hookStandsDown,
  isPaqadDisabled,
  parseHookPayload,
  resolveProjectRoot,
} from './lib/paqad-disabled.mjs';
import { resolveCompletionTranscriptText } from './lib/transcript.mjs';
import { refreshHudFromHook } from './lib/hud-snapshot.mjs';

const ADAPTER = process.argv[2] || undefined;

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
    const transcriptText = resolveCompletionTranscriptText(input, ADAPTER);
    if (!transcriptText) return 0;

    const distUrl = new URL('../../dist/stage-evidence/marker-parse.js', import.meta.url);
    const { parseAndRecordMarkers } = await import(distUrl.href);
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
  main(input).then(async (code) => {
    await refreshHudFromHook(input, 'stage-marker-parse');
    process.exit(code);
  });
});
process.stdin.resume();
