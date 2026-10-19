// cost-refresh.mjs: rewrite the active change's cost.json at the end of a hook (issue #639,
// Part 23, decision D-01M5AM0F03B730SDSAPVC96W38).
//
// Called from the Stop hook (verification-completion.mjs) and the SubagentStop hook
// (stage-agent-completion.mjs) AFTER each one's decision is final: the exit code has been
// computed and anything it prints has been written. It records the transcript paths the payload
// names, reads only the bytes they gained since the last run, and rewrites the bundle's
// cost.json, so it can never change what the hook decided. It stands down wherever the hook
// itself stands down, and every failure, including a missing dist entry, is logged to
// .paqad/logs/hooks.log and swallowed.

import {
  appendHooksLog,
  hookStandsDown,
  isPaqadDisabled,
  parseHookPayload,
  resolveProjectRoot,
} from './paqad-disabled.mjs';

/**
 * Refresh the change cost for the payload. Never throws, never rejects, and returns nothing a
 * caller could branch on.
 *
 * @param {string} input The raw hook payload (stdin).
 * @param {string} hook  The hook's name, for the log line.
 * @param {(href: string) => Promise<any>} [load] Module loader, injectable for tests.
 */
export async function refreshCostFromHook(input, hook, load = (href) => import(href)) {
  let projectRoot = null;
  try {
    const payload = parseHookPayload(input);
    projectRoot = resolveProjectRoot(process.env, payload);
    if (!payload || isPaqadDisabled(projectRoot) || hookStandsDown(payload)) {
      return;
    }
    const url = new URL('../../../dist/cost/hook-cost.js', import.meta.url);
    const { refreshChangeCostFromHook } = await load(url.href);
    refreshChangeCostFromHook({ projectRoot, payload });
  } catch (error) {
    if (projectRoot) {
      const message = error instanceof Error ? error.message : String(error);
      appendHooksLog(projectRoot, `${hook}: cost not recorded: ${message}`);
    }
  }
}
