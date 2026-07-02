#!/usr/bin/env node
// analytics-tag-marker-parse.mjs — records analytics-tag markers on Claude completion
// (issue #241). The Claude completion backstop for the live PreToolUse writer: it parses the
// turn transcript for `paqad:analytics-tag <name> [<provider> [<path>]]` control lines and
// script-mints a row for each not-yet-recorded tag. Gated on the analytics flag, non-blocking,
// best-effort: always exits 0.
//
// Thin by contract (parse logic lives in dist/analytics-tag/marker-parse.js): drain stdin →
// guard (paqad-disabled + analytics flag) → read transcript → lazy-import → record → exit 0.

import { readFileSync } from 'node:fs';
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
    if (!analyticsEnabled(projectRoot)) return 0;

    let payload;
    try {
      payload = JSON.parse(input);
    } catch {
      /* v8 ignore next */
      return 0;
    }
    const transcriptPath = payload?.transcript_path ?? null;
    if (!transcriptPath) return 0;

    let transcriptText;
    try {
      transcriptText = readFileSync(transcriptPath, 'utf8');
    } catch {
      /* v8 ignore next */
      return 0;
    }

    const distUrl = new URL('../../dist/analytics-tag/marker-parse.js', import.meta.url);
    const { parseAndRecordAnalyticsTags } = await import(distUrl.href);
    parseAndRecordAnalyticsTags({
      projectRoot,
      transcriptText,
      sessionId: payload?.session_id ?? null,
      adapter: 'claude-code',
      analyticsEnabled: true,
    });
    return 0;
  } catch {
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
