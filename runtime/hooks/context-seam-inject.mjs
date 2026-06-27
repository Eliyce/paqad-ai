#!/usr/bin/env node
// context-seam-inject.mjs — UserPromptSubmit hook entry for the session-time
// injection seam (RAG buildout F2).
//
// On every user prompt it reads the PRECOMPUTED context artifact and writes a
// `[paqad-context]` block to stdout. Claude Code (and any host that injects
// UserPromptSubmit stdout into the model context) then puts that block in front
// of the model before the turn is planned. The design is provider-agnostic: the
// only host requirement is "stdout from this hook reaches the model".
//
// Guarantees (FEATURES.md hard constraints):
//   - Read-only + budgeted: it only stat+reads a small precomputed file under a
//     hard time budget. No embedding/indexing/sync happens here (that is the
//     background harness's job, F1/F9). The hook returns in well under the prompt
//     path's tolerance.
//   - Never blocks: it ALWAYS exits 0 and swallows every error. A missing
//     artifact, a disabled project, or any failure emits nothing and the agent
//     proceeds with grep/read exactly as today (F3).
//
// Project root is resolved from the host env (CLAUDE_PROJECT_DIR /
// PAQAD_PROJECT_ROOT, falling back to cwd) via the shared helper, so the single
// global copy under ~/.paqad-ai/current/hooks/ operates on whichever project the
// session is in.

import process from 'node:process';

import { buildInjection, isRagEnabledValue } from '../scripts/context-seam.mjs';
import { isPaqadDisabled, readLayeredKey, resolveProjectRoot } from './lib/paqad-disabled.mjs';

function emitContext() {
  try {
    const projectRoot = resolveProjectRoot();
    // Issue #220: when paqad is disabled the seam is a pure no-op — emitting a
    // `[paqad-context]` line would contaminate the OFF arm of an A/B comparison.
    if (isPaqadDisabled(projectRoot)) return;

    // RAG buildout F3 — disabled/cold-start == today's behavior. The injection
    // accelerator is OFF by default (honest grep/agentic default); only an
    // explicit `rag_enabled` truthy value turns it on. When off we emit nothing,
    // converging disabled == missing == baseline, even if a stale artifact from a
    // previously-enabled run still sits on disk.
    if (!isRagEnabledValue(readLayeredKey(projectRoot, 'rag_enabled', 'PAQAD_RAG_ENABLED'))) {
      return;
    }

    const block = buildInjection(projectRoot);
    if (block) process.stdout.write(`${block}\n`);
  } catch {
    // Never let the seam break a turn. Emit nothing on any failure.
  }
}

// The host pipes the prompt payload to our stdin; we do not need it. Drain it so
// the process never hangs on the pipe, then emit. When invoked with stdin
// redirected from /dev/null (the bash gate does this) EOF fires immediately.
let done = false;
const run = () => {
  if (done) return;
  done = true;
  emitContext();
};

process.stdin.on('data', () => {});
process.stdin.on('end', run);
process.stdin.on('error', run);
process.stdin.resume();
