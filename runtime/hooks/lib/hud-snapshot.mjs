// hud-snapshot.mjs — refresh the session's paqad HUD snapshot at the end of a hook (issue #639,
// Part 7).
//
// Called from a hook's exit path AFTER its decision is final: the exit code has been computed
// and anything it prints has been written. It only rewrites
// `.paqad/session/hud/<session>.json`, so it can never change what the hook decided
// (guardrail rule 3). It stands down wherever the hook itself stands down (paqad disabled, the
// npm copy stepping aside for the plugin, a plugin in a never-onboarded repo), and every
// failure, including a missing dist entry, is logged and swallowed.

import { logHookFailure } from './hook-log.mjs';
import {
  hookStandsDown,
  isPaqadDisabled,
  parseHookPayload,
  resolveProjectRoot,
} from './paqad-disabled.mjs';

/**
 * Refresh the snapshot for the session named in the hook payload. Never throws, never
 * rejects, and returns nothing a caller could branch on.
 *
 * @param {string} input The raw hook payload (stdin).
 * @param {string} hook  The hook's name, for the failure log.
 * @param {(href: string) => Promise<any>} [load] Module loader, injectable for tests.
 */
export async function refreshHudFromHook(input, hook, load = (href) => import(href)) {
  let projectRoot = null;
  try {
    const payload = parseHookPayload(input);
    projectRoot = resolveProjectRoot(process.env, payload);
    if (isPaqadDisabled(projectRoot) || hookStandsDown(payload)) {
      return;
    }
    const url = new URL('../../../dist/hud/refresh.js', import.meta.url);
    const { refreshHudSnapshot } = await load(url.href);
    const sessionId = typeof payload?.session_id === 'string' ? payload.session_id : null;
    refreshHudSnapshot(projectRoot, sessionId, `hook:${hook}`);
  } catch (error) {
    if (projectRoot) logHookFailure(projectRoot, `${hook}:hud-snapshot`, error);
  }
}
