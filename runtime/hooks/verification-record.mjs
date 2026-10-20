#!/usr/bin/env node

import process from 'node:process';

import { isPaqadDisabled, parseHookPayload, resolveProjectRoot } from './lib/paqad-disabled.mjs';
import { resolveCompletionTranscriptText } from './lib/transcript.mjs';
import { sessionIdFromStdin } from './lib/context-seam-emit.mjs';
import { runVerificationBackstop } from '../scripts/verify-backstop.mjs';

const ADAPTER_TYPE = process.argv[2] || undefined;

let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  void main(input);
});
process.stdin.resume();

const silent = { write: () => true };

async function recordMarkers(projectRoot, rawInput) {
  try {
    const payload = JSON.parse(rawInput);
    const transcriptText = resolveCompletionTranscriptText(rawInput, ADAPTER_TYPE);
    if (!transcriptText) return;
    const distUrl = new URL('../../dist/stage-evidence/marker-parse.js', import.meta.url);
    const { parseAndRecordMarkers } = await import(distUrl.href);
    parseAndRecordMarkers({
      projectRoot,
      transcriptText,
      sessionId: payload?.session_id ?? null,
      adapter: ADAPTER_TYPE,
    });
  } catch {}
}

async function main(rawInput) {
  const projectRoot = resolveProjectRoot(process.env, parseHookPayload(rawInput));
  if (!isPaqadDisabled(projectRoot)) {
    await recordMarkers(projectRoot, rawInput);
  }
  try {
    await runVerificationBackstop({
      origin: 'hook-completion',
      softFail: true,
      projectRoot,
      hostSessionId: sessionIdFromStdin(rawInput),
      stdout: silent,
      stderr: silent,
    });
  } catch {}
  process.exit(0);
}
