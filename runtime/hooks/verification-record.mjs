#!/usr/bin/env node
// Record-only completion hook for a host whose native "agent finished" hook must
// never disrupt the agent and cannot block — Gemini CLI's `AfterAgent`.
//
// (Codex CLI no longer uses this hook: it renders the full blocking completion chain
// like Claude Code, issue #566. This remains for Gemini, whose tier is unchanged.)
//
// It does two record-only things at turn end, both purely for their side effect:
//   1. Runs the same verification backstop Claude Code's `Stop` hook runs, so when
//      enterprise evidence is enabled the evidence ledger / receipt / AI-BOM is
//      written under `.paqad/ledger/`.
//   2. Parses the agent's `paqad:stage <stage> <start|end>` control lines out of the
//      turn transcript and records the non-mutation stages into the SAME stage-evidence
//      ledger the backstop folds (issue #265), attributed to the host that ran.
//
// Unlike `verification-completion.mjs`, this hook ALWAYS exits 0 and emits nothing on
// stdout/stderr, so a failing gate, an infra error, or a marker-parse error can never
// halt the host, trigger a retry loop, or be misread by a host that parses Stop-hook
// stdout as a control "decision". There is no in-chat verdict on this host — the
// verdict lives in the ledger, not the chat.

import process from 'node:process';

import { isPaqadDisabled, resolveProjectRoot } from './lib/paqad-disabled.mjs';
import { resolveCompletionTranscriptText } from './lib/transcript.mjs';
import { sessionIdFromStdin } from './lib/context-seam-emit.mjs';
import { runVerificationBackstop } from '../scripts/verify-backstop.mjs';

// The host adapter type, passed as argv by the generated hook command so recorded
// stage rows are honestly attributed (issue #265). Absent → undefined, and the
// recorder defaults attribution to claude-code.
const ADAPTER_TYPE = process.argv[2] || undefined;

// Drain stdin (the host pipes an AfterAgent JSON payload) so the process does not hang
// on the pipe, then run the record-only work.
let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  void main(input);
});
// If stdin is already closed (no pipe), `end` may not fire — guard with resume.
process.stdin.resume();

const silent = { write: () => true };

/** Best-effort marker recording: parse the transcript and mint the stage rows the
 *  agent marked. Any failure (no payload, no dist, fs/parse error) is swallowed. */
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
  } catch {
    // Record-only: a malformed payload or a missing dist bundle simply means no
    // marker rows this run — never a thrown or non-zero-exiting hook.
  }
}

async function main(rawInput) {
  // One resolved root for both the marker rows and the backstop fold, so they can
  // never key on different projects (honors PAQAD_PROJECT_ROOT, cwd fallback).
  const projectRoot = resolveProjectRoot();
  // Skip marker recording when paqad is disabled. The backstop also short-circuits
  // internally when disabled (verify-backstop.mjs), but it additionally records a
  // disabled-session audit row, so it is still invoked below.
  if (!isPaqadDisabled(projectRoot)) {
    await recordMarkers(projectRoot, rawInput);
  }
  try {
    await runVerificationBackstop({
      origin: 'hook-completion',
      softFail: true,
      projectRoot,
      // Thread the host session id so finalization keys on the LIVE session, not the
      // stale single-slot cache — the same bug #5 fix verification-completion.mjs makes.
      hostSessionId: sessionIdFromStdin(rawInput),
      stdout: silent,
      stderr: silent,
    });
  } catch {
    // Record-only: a broken install or a thrown error must never disrupt the host
    // agent. The ledger simply is not written this run.
  }
  process.exit(0);
}
