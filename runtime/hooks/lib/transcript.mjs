// transcript.mjs — the one way a Stop hook reads the turn transcript.
//
// Two Stop hooks need it: the marker parser (which stages did the agent mark?) and
// the narration audit (issue #409 — did the agent actually SAY them?). Both answer
// questions about the same bytes, so a second hand-rolled copy of "parse the payload,
// find transcript_path, read it" would let them disagree about the same turn.
//
// Best-effort by contract: a non-JSON payload, an absent `transcript_path`, or an
// unreadable file all yield `null`. A hook must never wedge the agent because the
// host moved or withheld a transcript.

import { readFileSync } from 'node:fs';

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
