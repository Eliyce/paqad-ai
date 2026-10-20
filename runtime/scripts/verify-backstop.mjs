#!/usr/bin/env node

import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { logHookFailure } from '../hooks/lib/hook-log.mjs';
import { isPaqadDisabled } from '../hooks/lib/paqad-disabled.mjs';

async function recordDisabledSessionSafe(projectRoot, hostSessionId, origin) {
  try {
    const distUrl = new URL('../../dist/session-ledger/disabled-audit.js', import.meta.url);
    const { recordDisabledSession } = await import(distUrl.href);
    recordDisabledSession(projectRoot, { sessionId: hostSessionId ?? null, origin });
  } catch {}
}

export async function loadPaqadApi() {
  const distUrl = new URL('../../dist/index.js', import.meta.url);
  return import(distUrl.href);
}

export function verdictHasHardFailure(verdict) {
  if (Array.isArray(verdict?.gates)) {
    return verdict.gates.some((gate) => gate?.status === 'fail');
  }
  return verdict?.ok === false;
}

export function blockReason(verdict) {
  const summary = verdict?.summary ?? 'A verification gate is blocking this change.';
  return (
    `${summary}\n` +
    'Resolve the blocking item(s) above before ending the turn: mark any missing ' +
    'feature-development stage (planning → specification → development → review → checks → ' +
    'documentation_sync) with an artifact-bearing end, run `paqad-ai checks run` so tests are ' +
    'proven, and fix any failing gate. This turn is held open until the change verifies.'
  );
}

export async function runVerificationBackstop({
  origin,
  softFail,
  projectRoot,
  hostSessionId,
  stdout,
  stderr,
  loopActive,
  transcriptText,
}) {
  const out = stdout ?? process.stdout;
  const err = stderr ?? process.stderr;
  if (isPaqadDisabled(projectRoot)) {
    if (origin === 'hook-completion') {
      await recordDisabledSessionSafe(projectRoot, hostSessionId, origin);
    }
    return 0;
  }
  try {
    const api = await loadPaqadApi();
    const verdict = await api.runRepositoryVerification({
      projectRoot,
      origin,
      hostSessionId: hostSessionId ?? null,
      transcriptText: transcriptText ?? null,
    });
    const receipt = verdict.receipt ?? verdict.summary;

    if (origin === 'hook-completion') {
      try {
        api.writeHudReceipt(projectRoot, hostSessionId ?? null, verdict);
      } catch (error) {
        logHookFailure(projectRoot, 'verify-backstop:hud-receipt', error);
      }
      const payload = {};
      if (verdictHasHardFailure(verdict) && !loopActive) {
        payload.decision = 'block';
        payload.reason = verdict.narrationAdvisory
          ? `${blockReason(verdict)}\n\n${verdict.narrationAdvisory}`
          : blockReason(verdict);
      }
      if (payload.decision) {
        out.write(`${JSON.stringify(payload)}\n`);
      }
      return 0;
    }

    if (verdict.ok) {
      out.write(`${receipt}\n`);
      return 0;
    }
    err.write(`${receipt}\n`);
    return 2;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    err.write(`[paqad] verification backstop could not run: ${message}\n`);
    return softFail ? 0 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origin =
    process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'git-backstop';
  const softFail = process.argv.includes('--soft-fail');
  const code = await runVerificationBackstop({
    origin,
    softFail,
    projectRoot: process.cwd(),
  });
  process.exit(code);
}
