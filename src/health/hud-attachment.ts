import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const HEARTBEAT_WINDOW_MS = 120_000;
export const SNAPSHOT_FRESH_MS = 15 * 60_000;
export const CLOUD_HUD_LINE =
  "The paqad HUD cannot draw in a cloud session: Claude Code shows no plugin view there. paqad's checks still run.";
export const HUD_NOT_ATTACHED_NOTE =
  'HUD not attached: this Claude Code session has a fresh paqad snapshot, but the paqad HUD has not drawn it.';
export const HUD_NOT_ATTACHED_FIX =
  'Install or turn on the paqad plugin (`claude plugin install paqad@eliyce --scope user`), then type /reload-plugins.';

const HUD_DIR = join('.paqad', 'session', 'hud');
const DAY_MS = 24 * 60 * 60_000;

export type HudAttachment =
  | { state: 'cloud' }
  | { state: 'no-session' }
  | { state: 'attached'; sessionId: string }
  | { state: 'unattached'; sessionId: string };

function mtimeOf(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

function within(at: number | null, now: number, window: number): boolean {
  return at !== null && now - at >= 0 && now - at <= window;
}

function latestSession(projectRoot: string, now: number): string | null {
  let names: string[];
  try {
    names = readdirSync(join(projectRoot, HUD_DIR));
  } catch {
    return null;
  }
  let latest: { id: string; at: number } | null = null;
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const at = mtimeOf(join(projectRoot, HUD_DIR, name));
    if (!within(at, now, DAY_MS)) continue;
    if (latest === null || at! > latest.at) latest = { id: name.slice(0, -5), at: at! };
  }
  return latest?.id ?? null;
}

export function readHudAttachment(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
): HudAttachment {
  if (
    String(env.CLAUDE_CODE_REMOTE ?? '')
      .trim()
      .toLowerCase() === 'true'
  )
    return { state: 'cloud' };
  const sessionId = latestSession(projectRoot, now);
  if (sessionId === null) return { state: 'no-session' };
  const dir = join(projectRoot, HUD_DIR);
  const heartbeat = mtimeOf(join(dir, `${sessionId}.live`));
  if (within(heartbeat, now, HEARTBEAT_WINDOW_MS)) return { state: 'attached', sessionId };
  const recorded = existsSync(join(dir, `${sessionId}.unattached`));
  const snapshotFresh = within(mtimeOf(join(dir, `${sessionId}.json`)), now, SNAPSHOT_FRESH_MS);
  if (recorded || snapshotFresh) return { state: 'unattached', sessionId };
  return { state: 'attached', sessionId };
}

export function unattachedNote(projectRoot: string, sessionId: string): string {
  try {
    const record = JSON.parse(
      readFileSync(join(projectRoot, HUD_DIR, `${sessionId}.unattached`), 'utf8'),
    ) as { note?: unknown };
    if (typeof record.note === 'string' && record.note !== '') return record.note;
  } catch {}
  return HUD_NOT_ATTACHED_NOTE;
}
