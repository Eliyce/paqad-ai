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

/**
 * Record a disabled-session audit row, best-effort (buildout F2b). Lazy-imports
 * the small dist recorder; any failure (uninstalled package → no dist, fs error)
 * is swallowed so the disable path can never break. Mirrors how capability-gate
 * resolves its dist bundle relative to the module URL.
 */
async function recordDisabledSessionSafe(projectRoot, hostSessionId, origin) {
  try {
    const distUrl = new URL('../../dist/session-ledger/disabled-audit.js', import.meta.url);
    const { recordDisabledSession } = await import(distUrl.href);
    recordDisabledSession(projectRoot, { sessionId: hostSessionId ?? null, origin });
  } catch {
    // Disabled + uninstalled (no dist) or any error → skip; auditing must never
    // disrupt a disabled session.
  }
}

export async function loadPaqadApi() {
  // This script ships inside the paqad-ai package (runtime/scripts/...), so its
  // built entry sits two levels up at dist/index.js. Resolving relative to the
  // module URL works whether paqad is installed globally, as a dependency, or
  // run from the repo itself.
  const distUrl = new URL('../../dist/index.js', import.meta.url);
  return import(distUrl.href);
}

/**
 * True when the verdict carries a HARD failure — at least one gate reported `fail`
 * (issue #368). This is stricter than `!verdict.ok`: a verdict is also not-ok when it
 * is merely Inconclusive (unproven signals, no failing gate), and Inconclusive must
 * surface visibly WITHOUT blocking the turn. Defensive: a verdict with no gates array
 * (older/mocked shapes) falls back to `!verdict.ok` so a real failure never slips
 * through as non-blocking.
 */
export function verdictHasHardFailure(verdict) {
  if (Array.isArray(verdict?.gates)) {
    return verdict.gates.some((gate) => gate?.status === 'fail');
  }
  return verdict?.ok === false;
}

/**
 * The concise, model-facing instruction attached to a `{decision:'block'}` on a hard
 * failure (issue #368). It reuses the verdict summary (which already names the failing
 * gates in paqad's voice) and appends one remediation line, so the model is told BOTH
 * what failed and how to clear it before the turn can end.
 */
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
}) {
  const out = stdout ?? process.stdout;
  const err = stderr ?? process.stderr;
  // Issue #220 — when paqad is disabled (or env-overridden off, or the package
  // is uninstalled so the off-signal can't be confirmed on either side), the
  // backstop runs NO gate: allow BEFORE running anything. This is a distinct
  // short-circuit from `softFail` (which only catches infra errors).
  if (isPaqadDisabled(projectRoot)) {
    // Buildout F2b (decision D1) — the disable escape hatch stays, but a real
    // agent completion while disabled is AUDITED: record one disabled-session row
    // so the bypass is visible in the dashboard/SIEM. Best-effort and lazy — if
    // the package is uninstalled the dist import simply throws and we skip, so the
    // "no enforcement when disabled" contract is untouched.
    if (origin === 'hook-completion') {
      await recordDisabledSessionSafe(projectRoot, hostSessionId, origin);
    }
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
    // Issue #325 — surface the ONE end-of-change receipt (verdict headline in
    // contract words + per-stage evidence). Fall back to the plain summary if no
    // receipt was composed.
    const message = verdict.receipt ?? verdict.summary;

    // Issue #368 — the Claude Stop hook. The developer-facing channel is the JSON
    // `{systemMessage}` on stdout at exit 0, which Claude renders whether the verdict
    // passes OR fails — so a "Needs your attention" receipt is exactly as visible as
    // "Safe to merge" (AC-C1), and a computed FAILED verdict can never be hidden on
    // stderr while a PR ships (AC-D1, the #353 disaster). Blocking rides on the
    // documented `{decision:'block'}` field, NOT exit 2 — exit 2 does not block a Stop
    // hook (it is a PreToolUse mechanism), so the old `return 2` was both invisible AND
    // a no-op. git/CI keep the exit-code-gated path below.
    if (origin === 'hook-completion') {
      const payload = { systemMessage: message };
      // Give the gate real teeth on a HARD failure (a gate reported `fail`, e.g. a
      // mandatory stage missing or a red checks report): tell the model to keep working
      // and resolve it before the turn ends. An Inconclusive verdict (no failing gate —
      // only unproven signals) is surfaced but never blocks: "do not over-trust", not
      // "you must fix". The loop guard (`loopActive`, from Claude's `stop_hook_active`)
      // means the gate already bit once this turn, so a second block would loop — step
      // aside and let the session end (git/CI remains the hard gate).
      if (verdictHasHardFailure(verdict) && !loopActive) {
        payload.decision = 'block';
        payload.reason = blockReason(verdict);
      }
      out.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }

    // git-backstop / ci-backstop — a real terminal / CI process where the exit code IS
    // the gate. Plain text reads better than JSON here, and a hard fail must exit 2 so
    // the commit / CI step fails. This layer never sets `loopActive`.
    if (verdict.ok) {
      out.write(`${message}\n`);
      return 0;
    }
    err.write(`${message}\n`);
    return 2;
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
