#!/usr/bin/env node
// stage-writer.mjs — the stage-evidence live writer (RCA fix A).
//
// A Claude PreToolUse hook on Edit|Write|NotebookEdit. It is a WRITER, not a gate:
// it script-mints per-stage `live-mark` rows (started_at/ended_at from the script
// clock) by handing the mutated file to the compiled `recordLiveStageEdit`, giving
// the stage-evidence recorder the production caller it never had. It ALWAYS exits 0
// — the block lives on the completion gate and the pre-mutation deny (fix B).
//
// Thin by contract (the branch logic lives in dist/stage-evidence/live-writer.js so
// it is coverage-counted): drain stdin → parse the tool payload → lazy-import →
// record → exit 0. Claude-only (the sole PreToolUse-capable host).

import process from 'node:process';

import { isPaqadDisabled, resolveProjectRoot } from './lib/paqad-disabled.mjs';

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
    const toolInput = payload?.tool_input ?? {};
    const targetPath = toolInput.file_path ?? toolInput.notebook_path;
    if (!toolName || !targetPath) return 0;

    const distUrl = new URL('../../dist/stage-evidence/live-writer.js', import.meta.url);
    const { recordLiveStageEdit } = await import(distUrl.href);
    recordLiveStageEdit({
      projectRoot,
      sessionId: payload?.session_id ?? null,
      toolName,
      targetPath,
    });
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
