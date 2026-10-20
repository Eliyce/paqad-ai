import {
  appendHooksLog,
  hookStandsDown,
  isPaqadDisabled,
  parseHookPayload,
  resolveProjectRoot,
} from './paqad-disabled.mjs';

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
