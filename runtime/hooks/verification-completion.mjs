#!/usr/bin/env node
// Issue #117 (C-1 + C-6) — completion (Stop) hook. The moment the host agent
// finishes, run the existing VerificationGateRunner against the working tree —
// independent of whether the agent chose to run the workflow's verification
// phase — and surface one trust verdict. A blocking contract violation exits 2
// (the host agent surfaces stderr to the model); a clean change exits 0.
//
// Fast-feedback layer only: it soft-fails on infra errors (a missing build, an
// import failure) so a broken install never wedges the agent. The
// non-bypassable layer is the git/CI backstop (verify-backstop.mjs), which
// fails hard.

import process from 'node:process';

import { sessionIdFromStdin } from './lib/context-seam-emit.mjs';
import { resolveProjectRoot } from './lib/paqad-disabled.mjs';
import { stopHookActiveFromStdin } from './lib/loop-guard.mjs';
import { runVerificationBackstop } from '../scripts/verify-backstop.mjs';

// Read the Stop-hook JSON payload: the host (Claude) puts the session_id here, and
// we thread it to verification so stage-evidence finalization keys on the LIVE
// session instead of a stale single-slot cache (buildout F5b, bug #5 — two ledger
// subdirs for one session). Draining stdin also keeps the process from hanging.
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
  const code = await runVerificationBackstop({
    origin: 'hook-completion',
    softFail: true,
    // Fix #1 — resolve the project root the host is operating on (CLAUDE_PROJECT_DIR
    // / PAQAD_PROJECT_ROOT, cwd fallback) via the shared helper, matching the sibling
    // Stop hooks. Raw process.cwd() missed the disable flag stored in the project's
    // .paqad/.config whenever the host launched the hook from a subdirectory, so an
    // OFF project still got blocked.
    projectRoot: resolveProjectRoot(),
    hostSessionId: sessionIdFromStdin(input),
    // Fix #2 — pass Claude's `stop_hook_active` so a block downgrades to advisory
    // once we are already inside a Stop-hook continuation loop (see loop-guard.mjs).
    loopActive: stopHookActiveFromStdin(input),
  });
  process.exit(code);
}
