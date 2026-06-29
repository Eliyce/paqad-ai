#!/usr/bin/env node
// Issue #117 (C-1) — the provider-independent verification backstop. Runs the
// existing VerificationGateRunner against repository reality via paqad's
// exported `runRepositoryVerification` API (no new CLI verb) and exits non-zero
// when a contract violation blocks. Invoked by the generated git pre-commit /
// pre-push hook and by the CI step — the layers an agent cannot pass
// `--no-verify` to.
//
// Usage: node verify-backstop.mjs [origin] [--soft-fail]
//   origin     git-backstop (default) | ci-backstop | hook-completion
//   --soft-fail infra errors (missing build, import failure) exit 0 instead of
//               1. Used by the in-session completion hook so a broken install
//               never wedges the agent; never used by CI, which must fail hard.

import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { isPaqadDisabled } from '../hooks/lib/paqad-disabled.mjs';

export async function loadPaqadApi() {
  // This script ships inside the paqad-ai package (runtime/scripts/...), so its
  // built entry sits two levels up at dist/index.js. Resolving relative to the
  // module URL works whether paqad is installed globally, as a dependency, or
  // run from the repo itself.
  const distUrl = new URL('../../dist/index.js', import.meta.url);
  return import(distUrl.href);
}

export async function runVerificationBackstop({
  origin,
  softFail,
  projectRoot,
  hostSessionId,
  stdout,
  stderr,
}) {
  const out = stdout ?? process.stdout;
  const err = stderr ?? process.stderr;
  // Issue #220 — when paqad is disabled (or env-overridden off, or the package
  // is uninstalled so the off-signal can't be confirmed on either side), the
  // backstop is a pure no-op: allow, write nothing, load no dist. This is a
  // distinct short-circuit from `softFail` (which only catches infra errors) so
  // the git/CI backstop allows BEFORE running any gate when off.
  if (isPaqadDisabled(projectRoot)) {
    return 0;
  }
  try {
    const api = await loadPaqadApi();
    // Thread the host session id (buildout F5b, #5) so stage-evidence finalization
    // keys on the live session, not a stale cache. Undefined on hosts/CI with no id.
    const verdict = await api.runRepositoryVerification({
      projectRoot,
      origin,
      hostSessionId: hostSessionId ?? null,
    });
    out.write(`${verdict.summary}\n`);
    return verdict.ok ? 0 : 2;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    err.write(`[paqad] verification backstop could not run: ${message}\n`);
    return softFail ? 0 : 1;
  }
}

// CLI entry — only when executed directly, not when imported by a hook.
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
