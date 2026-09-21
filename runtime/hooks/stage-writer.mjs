#!/usr/bin/env node
// stage-writer.mjs — the stage-evidence live writer (RCA fix A; issue #566).
//
// A PreToolUse hook on the host's mutating tool (Claude Edit|Write|NotebookEdit,
// Codex `apply_patch`). It is a WRITER, not a gate: it script-mints per-stage
// `live-mark` rows (started_at/ended_at from the script clock) by handing the
// mutated file(s) to the compiled `recordLiveStageEdits`, giving the stage-evidence
// recorder the production caller it never had. It ALWAYS exits 0 — the block lives
// on the completion gate and the pre-mutation deny (fix B).
//
// Host-aware via one argv (default `claude-code`): the edited paths come from the
// shared `editTargets` extractor, which understands Claude's `file_path` and Codex's
// `apply_patch` text alike, and the adapter argv attributes each row to the host that
// ran (issue #566). A Codex patch can touch several files, so it records one row per
// path. Thin by contract: the branch logic lives in dist/stage-evidence/live-writer.js
// so it is coverage-counted.

import process from 'node:process';

import { editTargets } from './lib/edit-targets.mjs';
import { isPaqadDisabled, resolveProjectRoot } from './lib/paqad-disabled.mjs';

// The host that invoked the hook (issue #566). `claude-code` is the default so an
// existing Claude installation is unaffected; Codex passes `codex-cli`.
const ADAPTER_TYPE = process.argv[2] || undefined;

async function main(input) {
  try {
    const projectRoot = resolveProjectRoot();
    if (isPaqadDisabled(projectRoot)) return 0;

    let payload;
    try {
      payload = JSON.parse(input);
    } catch {
      /* v8 ignore next */
      return 0;
    }
    const toolName = payload?.tool_name;
    const targetPaths = editTargets(payload);
    if (!toolName || targetPaths.length === 0) return 0;
    const sessionId = payload?.session_id ?? null;

    const liveUrl = new URL('../../dist/stage-evidence/live-writer.js', import.meta.url);
    const { recordLiveStageEdits } = await import(liveUrl.href);

    // Record one live-mark row per edited path (a Codex apply_patch can touch
    // several). The on-entry "▸ paqad · <stage>" narration is NOT printed from this
    // hook: the model speaks that line itself in its final message (the narration
    // contract). The ledger write below still runs, so the record is never silent.
    recordLiveStageEdits({ projectRoot, sessionId, toolName, targetPaths, adapter: ADAPTER_TYPE });
    return 0;
  } catch {
    // Soft-fail: a writer must never wedge the agent. The completion gate still
    // reports the honest stage set at turn end.
    /* v8 ignore next */
    return 0;
  }
}

let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  main(input).then((code) => process.exit(code));
});
process.stdin.resume();
