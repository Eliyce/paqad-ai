// transcript.mjs — the one way a Stop/completion hook reads the turn transcript.
//
// Several completion hooks need it: the marker parser (which stages did the agent
// mark?), the narration audit (issue #409 — did the agent actually SAY them?), and
// the verification backstop. All answer questions about the same bytes, so a
// hand-rolled copy of "parse the payload, find transcript_path, read it" would let
// them disagree about the same turn (RULE-13).
//
// Best-effort by contract: a non-JSON payload, an absent `transcript_path`, or an
// unreadable file all yield `null`/''. A hook must never wedge the agent because the
// host moved or withheld a transcript.

import { readFileSync } from 'node:fs';

import { resolveCodexRolloutText } from './codex-rollout.mjs';

/** The Stop payload's `transcript_path`, or null when absent / not JSON. */
export function transcriptPathFromStdin(stdin) {
  try {
    const parsed = JSON.parse(stdin);
    return typeof parsed?.transcript_path === 'string' ? parsed.transcript_path : null;
  } catch {
    return null;
  }
}

/** The transcript's text, or null when there is no readable transcript. */
export function transcriptTextFromStdin(stdin) {
  const path = transcriptPathFromStdin(stdin);
  if (!path) return null;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Resolve the transcript text a completion hook should scan for markers / audit,
 * across hosts (issue #566). Prefers a readable `transcript_path` (Claude and Codex
 * CLI expose one). On Codex, when the path is absent or unreadable — Codex Desktop's
 * `Stop` carried no readable `transcript_path` (issue #313) and its `paqad:stage`
 * markers live in MID-RUN messages the inline `last_assistant_message` never holds —
 * fall back to the session's own rollout jsonl off disk. Finally fall back to the
 * inline final message the payload carries. Returns '' when nothing is available;
 * never throws.
 */
export function resolveCompletionTranscriptText(stdin, adapter) {
  let payload;
  try {
    payload = JSON.parse(stdin);
  } catch {
    payload = undefined;
  }
  const path = payload?.transcript_path;
  if (typeof path === 'string' && path.trim() !== '') {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      // A stubbed/unreadable path is expected on some hosts — fall through.
    }
  }
  if (adapter === 'codex-cli') {
    const rollout = resolveCodexRolloutText(payload?.session_id);
    if (rollout) return rollout;
  }
  const inline = payload?.last_assistant_message ?? payload?.prompt_response;
  return typeof inline === 'string' ? inline : '';
}
