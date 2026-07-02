#!/usr/bin/env node
// analytics-tag-writer.mjs — the Claude live tier for the analytics-tag ledger (issue #241).
//
// A Claude PreToolUse hook on Edit|Write|NotebookEdit. It is a non-blocking WRITER, not a
// gate: when analytics instrumentation is enabled, it scans the content being written for
// analytics call sites and script-mints a `tag_added` row for each new tag. It ALWAYS exits
// 0 — coding correctness is never blocked by analytics (a tag-add failing is at most a 🟡).
//
// Thin by contract (branch logic lives in dist/analytics-tag/live-writer.js so it stays
// coverage-counted): drain stdin → guard (paqad-disabled + analytics flag) → extract the new
// content → lazy-import → record → exit 0. Claude-only (the sole PreToolUse-capable host).

import process from 'node:process';

import { isPaqadDisabled, readLayeredKey, resolveProjectRoot } from './lib/paqad-disabled.mjs';

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

function analyticsEnabled(projectRoot) {
  const raw = readLayeredKey(
    projectRoot,
    'analytics_instrumentation',
    'PAQAD_ANALYTICS_INSTRUMENTATION',
  );
  return typeof raw === 'string' && TRUTHY.has(raw.trim().toLowerCase());
}

async function main(input) {
  try {
    const projectRoot = resolveProjectRoot();
    if (isPaqadDisabled(projectRoot)) return 0;
    // Flag gate: OFF is silent — no scan, no row, in every branch.
    if (!analyticsEnabled(projectRoot)) return 0;

    let payload;
    try {
      payload = JSON.parse(input);
    } catch {
      /* v8 ignore next */
      return 0;
    }
    const toolInput = payload?.tool_input ?? {};
    const targetPath = toolInput.file_path ?? toolInput.notebook_path;
    // The text being written: Write content, Edit new_string, NotebookEdit new_source.
    const newText = toolInput.content ?? toolInput.new_string ?? toolInput.new_source;
    if (!targetPath || typeof newText !== 'string') return 0;

    const distUrl = new URL('../../dist/analytics-tag/live-writer.js', import.meta.url);
    const { recordLiveAnalyticsTags } = await import(distUrl.href);
    recordLiveAnalyticsTags({
      projectRoot,
      sessionId: payload?.session_id ?? null,
      targetPath,
      newText,
      adapter: 'claude-code',
      analyticsEnabled: true,
    });
    return 0;
  } catch {
    // Soft-fail: a writer must never wedge the agent.
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
