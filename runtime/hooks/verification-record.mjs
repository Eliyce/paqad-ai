#!/usr/bin/env node
// Record-only completion hook for hosts whose native "agent finished" hook must
// never disrupt the agent — Codex CLI's `Stop`, Gemini CLI's `AfterAgent`, etc.
//
// It does two record-only things at turn end, both purely for their side effect:
//   1. Runs the same verification backstop Claude Code's `Stop` hook runs, so when
//      enterprise evidence is enabled the evidence ledger / receipt / AI-BOM is
//      written under `.paqad/ledger/`.
//   2. Parses the agent's `paqad:stage <stage> <start|end>` control lines out of
//      the turn transcript and records the non-mutation stages (planning,
//      specification-as-thinking, review) into the SAME stage-evidence ledger the
//      backstop folds (issue #265 — the record tier ported from Claude to Codex /
//      Gemini). The per-stage rows are attributed to the host that ran, via the
//      adapter type passed as argv (`codex-cli` / `gemini-cli`).
//
// Unlike `verification-completion.mjs` (Claude's hook, which exits 2 on a blocking
// verdict so the host surfaces it to the model), this hook ALWAYS exits 0 and
// emits nothing on stdout/stderr. That guarantees a failing gate, an infra error,
// our human-readable summary, OR a marker-parse error can never halt the host,
// trigger a retry loop, or be misread by a host that parses Stop-hook stdout as a
// control "decision" (Codex rejects plain text on Stop; Gemini requires pure JSON
// on stdout). There is no in-chat verdict on these hosts — a deliberate,
// physics-bounded choice: the verdict lives in the ledger, not the chat.

import { readFileSync } from 'node:fs';
import process from 'node:process';

import { isPaqadDisabled, resolveProjectRoot } from './lib/paqad-disabled.mjs';
import { runVerificationBackstop } from '../scripts/verify-backstop.mjs';

// The host adapter type, passed as argv by the generated hook command so recorded
// stage rows are honestly attributed (issue #265). Absent → undefined, and the
// recorder defaults attribution to claude-code.
const ADAPTER_TYPE = process.argv[2] || undefined;

// Drain stdin (the host pipes a Stop/AfterAgent JSON payload) so the process does
// not hang on the pipe, then run the record-only work.
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

/**
 * Resolve the transcript text to scan for markers from the completion payload.
 * Prefers a readable `transcript_path` (Claude / Codex expose one; format need not
 * be stable — the parser falls back to a raw scan). Falls back to the inline final
 * message the payload carries when the path is absent, empty, or unreadable —
 * Codex `last_assistant_message`, Gemini `prompt_response` (Gemini's
 * `transcript_path` is currently stubbed to an empty string). '' when neither is
 * available. Never throws.
 */
function resolveTranscriptText(payload) {
  const path = payload?.transcript_path;
  if (typeof path === 'string' && path.trim() !== '') {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      // Fall through to the inline field — a stubbed/unreadable path is expected
      // on some hosts and must never disrupt the record run.
    }
  }
  const inline = payload?.last_assistant_message ?? payload?.prompt_response;
  return typeof inline === 'string' ? inline : '';
}

/** Best-effort marker recording: parse the transcript and mint the stage rows the
 *  agent marked. Any failure (no payload, no dist, fs/parse error) is swallowed. */
async function recordMarkers(projectRoot, rawInput) {
  try {
    const payload = JSON.parse(rawInput);
    const transcriptText = resolveTranscriptText(payload);
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
      stdout: silent,
      stderr: silent,
    });
  } catch {
    // Record-only: a broken install or a thrown error must never disrupt the host
    // agent. The ledger simply is not written this run.
  }
  process.exit(0);
}
