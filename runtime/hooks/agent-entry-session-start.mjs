#!/usr/bin/env node
// agent-entry-session-start.mjs — SessionStart hook (cross-platform port of
// agent-entry-session-start.sh, #240).
//
// Two best-effort jobs, both always exit 0:
//   1. Every new session must start ungated — delete the sentinel so the agent is
//      forced to load its provider entry file again.
//   2. Align the single-slot ledger-session cache to the LIVE host session id
//      (issue #380, Issue 1). Claude puts `session_id` on the SessionStart stdin
//      payload; persisting it here means a shell `paqad-ai stage start --title`
//      invoked before the first edit resolves the CURRENT session, not a prior
//      session's id still sitting in the cache — which would otherwise mint the
//      feature bundle under a stale session while the PreToolUse gate keys on the
//      true host id (orphan bundle + blocked edit, "bug #5"). This extends the
//      bug #5 mitigation from finalization to bundle minting.

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { clearAgentEntryMarkers } from './lib/agent-entry-sentinel.mjs';
import { resolveProjectRoot } from './lib/paqad-disabled.mjs';
import { sessionIdFromStdin } from './lib/context-seam-emit.mjs';

async function main(input) {
  const projectRoot = resolveProjectRoot();

  try {
    rmSync(join(projectRoot, '.paqad', '.agent-entry-loaded'), { force: true });
    // Issue #567 — reset the per-agent entry markers too, so a new main session starts every
    // subagent identity ungated, exactly as the base sentinel resets.
    clearAgentEntryMarkers(projectRoot);
  } catch {
    // best-effort; never fail a session start.
  }

  // Align the ledger-session cache to the live host session id. Lazy-import the
  // compiled resolver (dedicated dist entry) so this stays a thin wrapper and the
  // persist logic is coverage-counted. Any failure (uninstalled package → no dist,
  // fs error, no id on stdin) is swallowed — a later hook that carries the host id
  // re-aligns the cache.
  try {
    const hostSessionId = sessionIdFromStdin(input);
    if (hostSessionId) {
      const distUrl = new URL('../../dist/rag-ledger/session.js', import.meta.url);
      const { persistLedgerSessionId } = await import(distUrl.href);
      persistLedgerSessionId(projectRoot, hostSessionId);

      // Carry an in-flight change across a session-id rotation (issue #404). A rotated
      // id reads a FRESH `_session` control, so without this the next stage/edit mints a
      // second bundle and orphans the one the change is already recorded in. Reconciling
      // here repoints the new session at the in-flight bundle (and clears a pointer at a
      // bundle dir that was never materialized) before the agent runs anything. Never
      // mints — with nothing in flight, or several, it leaves the control alone.
      const adoptUrl = new URL('../../dist/feature-evidence/adoption.js', import.meta.url);
      const { reconcileSessionControl } = await import(adoptUrl.href);
      reconcileSessionControl(projectRoot, hostSessionId);

      // Issue #576 (Finding 1b) — record a baseline of the tracked files that are ALREADY dirty
      // at session start, so the in-session completion backstop can subtract inherited dirt
      // instead of blaming a read-only turn for it. Captured once per session, keyed by the same
      // resolved session id the backstop reads. Best-effort — a failure just means no subtraction.
      const baselineUrl = new URL('../../dist/pipeline/dirty-baseline.js', import.meta.url);
      const { captureSessionDirtyBaseline } = await import(baselineUrl.href);
      await captureSessionDirtyBaseline(projectRoot, hostSessionId);
    }
  } catch {
    // best-effort; never fail a session start over cache alignment.
  }

  return 0;
}

let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  main(input).then((code) => process.exit(code));
});
// If stdin is already closed (no pipe), `end` may not fire — guard with resume so
// the hook still runs (and still deletes the sentinel) with an empty payload.
process.stdin.resume();
