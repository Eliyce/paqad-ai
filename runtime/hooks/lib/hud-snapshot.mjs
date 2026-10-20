import { logHookFailure } from './hook-log.mjs';
import {
  hookStandsDown,
  isPaqadDisabled,
  parseHookPayload,
  resolveProjectRoot,
} from './paqad-disabled.mjs';

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
