#!/usr/bin/env node

import { rmSync } from 'node:fs';
import process from 'node:process';

import { clearAgentEntryMarkers, sentinelPath } from './lib/agent-entry-sentinel.mjs';
import { hookStandsDown, parseHookPayload, resolveProjectRoot } from './lib/paqad-disabled.mjs';
import { sessionIdFromStdin } from './lib/context-seam-emit.mjs';

async function main(input) {
  const projectRoot = resolveProjectRoot(process.env, parseHookPayload(input));

  if (hookStandsDown(parseHookPayload(input))) return 0;

  try {
    rmSync(sentinelPath(projectRoot, sessionIdFromStdin(input)), { force: true });
    clearAgentEntryMarkers(projectRoot);
  } catch {}

  try {
    const hostSessionId = sessionIdFromStdin(input);
    if (hostSessionId) {
      const distUrl = new URL('../../dist/rag-ledger/session.js', import.meta.url);
      const { persistLedgerSessionId } = await import(distUrl.href);
      persistLedgerSessionId(projectRoot, hostSessionId);

      const adoptUrl = new URL('../../dist/feature-evidence/adoption.js', import.meta.url);
      const { reconcileSessionControl } = await import(adoptUrl.href);
      reconcileSessionControl(projectRoot, hostSessionId);

      const baselineUrl = new URL('../../dist/pipeline/dirty-baseline.js', import.meta.url);
      const { captureSessionDirtyBaseline } = await import(baselineUrl.href);
      await captureSessionDirtyBaseline(projectRoot, hostSessionId);
    }
  } catch {}

  return 0;
}

let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  main(input).then((code) => process.exit(code));
});
process.stdin.resume();
