#!/usr/bin/env node
// Issue #117 (C-1 + C-6) — completion (Stop) hook. The moment the host agent
// finishes, run the existing VerificationGateRunner against the working tree —
// independent of whether the agent chose to run the workflow's verification
// phase — and surface one trust verdict. A blocking contract violation exits 2
// (the host agent surfaces stderr to the model); a clean change exits 0.
//
// Runs on Claude Code AND Codex CLI (issue #566): both document the same Stop
// semantics (a `decision: "block"` continues the turn), so the same hook drives
// both. The host is passed as one argv (default `claude-code`; Codex passes
// `codex-cli`) so the transcript resolves from the Codex rollout jsonl when the
// Stop payload carries no readable `transcript_path`.
//
// Fast-feedback layer only: it soft-fails on infra errors (a missing build, an
// import failure) so a broken install never wedges the agent. The
// non-bypassable layer is the git/CI backstop (verify-backstop.mjs), which
// fails hard.

import process from 'node:process';

import { sessionIdFromStdin } from './lib/context-seam-emit.mjs';
import {
  hookStandsDown,
  isPaqadDisabled,
  parseHookPayload,
  resolveProjectRoot,
} from './lib/paqad-disabled.mjs';
import { stopHookActiveFromStdin } from './lib/loop-guard.mjs';
import { resolveCompletionTranscriptText } from './lib/transcript.mjs';
import { runVerificationBackstop } from '../scripts/verify-backstop.mjs';
import { refreshHudFromHook } from './lib/hud-snapshot.mjs';
import { refreshCostFromHook } from './lib/cost-refresh.mjs';

// The host that invoked the hook (issue #566): `claude-code` (default) or `codex-cli`.
const ADAPTER = process.argv[2] || undefined;

// Read the Stop-hook JSON payload: the host (Claude / Codex) puts the session_id here,
// and we thread it to verification so stage-evidence finalization keys on the LIVE
// session instead of a stale single-slot cache (buildout F5b, bug #5). Draining stdin
// also keeps the process from hanging.
let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  void main();
});
// If stdin is already closed (no pipe), `end` may not fire — guard with resume.
process.stdin.resume();

async function main() {
  // Fix #1 — resolve the project root the host is operating on (worktree payload cwd, then
  // CLAUDE_PROJECT_DIR / PAQAD_PROJECT_ROOT / cwd) via the shared helper, matching the sibling
  // Stop hooks. Raw process.cwd() missed the disable flag stored in the project's .paqad/.config
  // whenever the host launched the hook from a subdirectory.
  const projectRoot = resolveProjectRoot(process.env, parseHookPayload(input));

  // Issue #636 (bug 1) — a plugin-reached completion hook in a project that was never onboarded is a
  // pure no-op (the plugin installs at user scope and runs in every repo). Issue #667 — it also stands
  // down when the other copy owns the session, so one Stop is judged by exactly one chain.
  if (hookStandsDown(parseHookPayload(input))) {
    process.exit(0);
    return;
  }

  // Issue #615 (Part 4) — on Desktop/VS Code the orchestrator's turn can end while a dispatched
  // `paqad-<stage>` agent is still running in the background. Judging the change now would grade a
  // half-finished one. When a stage agent is still in `background_tasks`, step aside: record a
  // `completion-deferred` breadcrumb, run no backstop, and exit 0. The stage agent's completion
  // notice (Part 2) later drives the change on.
  // Issue #673 — a disabled project never defers: it falls through to the backstop, whose own
  // disabled check writes the one disabled-session audit row and nothing else (the order
  // capability-gate.mjs already uses).
  if (!isPaqadDisabled(projectRoot) && (await deferredForBackgroundStage(projectRoot))) {
    process.exit(0);
    return;
  }

  // Issue #409 — the turn transcript, so the backstop can check whether the stages it
  // recorded were ever spoken in VISIBLE text. On Codex the Stop payload may carry no
  // readable transcript_path, so fall back to the session rollout jsonl (#313). Empty
  // reads as "cannot tell" (null) and produces no advisory.
  const transcriptText = resolveCompletionTranscriptText(input, ADAPTER) || null;
  const code = await runVerificationBackstop({
    origin: 'hook-completion',
    softFail: true,
    projectRoot,
    hostSessionId: sessionIdFromStdin(input),
    // Fix #2 — pass the host's `stop_hook_active` so a block downgrades to advisory
    // once we are already inside a Stop-hook continuation loop (see loop-guard.mjs).
    loopActive: stopHookActiveFromStdin(input),
    transcriptText,
  });
  // Issue #639 (Part 23): rewrite the change's cost.json from the transcripts' new bytes, so the
  // HUD refresh below picks it up. Record-only: it logs its own failure to .paqad/logs/hooks.log
  // and the code above is already final.
  await refreshCostFromHook(input, 'verification-completion');
  // Issue #639 (Part 7) — refresh the HUD snapshot after the backstop wrote its receipt, so
  // the snapshot carries this turn's verdict. The code above is already final.
  await refreshHudFromHook(input, 'verification-completion');
  process.exit(code);
}

/**
 * Issue #615 (Part 4) — true when a `paqad-<stage>` agent is still running in the Stop payload's
 * `background_tasks` (or, for a payload shape with no agent type, a background task is running
 * while this session owns an open stage). Appends the `completion-deferred` row as a side effect.
 * Cheap and best-effort: no `background_tasks` → no dist import, returns false; any error falls
 * through to the normal verdict below (which itself soft-fails).
 */
async function deferredForBackgroundStage(projectRoot) {
  const payload = parseHookPayload(input);
  const tasks = payload && Array.isArray(payload.background_tasks) ? payload.background_tasks : [];
  if (tasks.length === 0) {
    return false;
  }
  try {
    const distUrl = new URL('../../dist/stage-evidence/completion-deferred.js', import.meta.url);
    const { deferCompletionForBackgroundStage } = await import(distUrl.href);
    return deferCompletionForBackgroundStage({
      projectRoot,
      backgroundTasks: tasks,
      sessionId: sessionIdFromStdin(input),
      adapter: ADAPTER ?? 'claude-code',
    }).deferred;
  } catch {
    return false;
  }
}
