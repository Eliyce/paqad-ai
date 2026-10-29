import type { PaqadHudSnapshot } from './types';

export const PAQAD_CLI_TIMEOUT_MS = 15_000;

export function overrideRecorded(stdout: string): boolean {
  return stdout.includes('recorded a one-time override') || stdout.includes('"overridden":true');
}

export interface PaqadRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export const CI_POLL_FIRST_MS = 30_000;
export const CI_POLL_MAX_MS = 300_000;
export const CI_WATCH_LIMIT_MS = 3_600_000;
export const CI_WATCH_TIMED_OUT = 'checked for 60 minutes';
export const CI_PAUSED_PREFIX = 'CI updates paused: ';

const WATCH_ENDING_REASONS: readonly string[] = ['gh is signed out', 'gh is not installed'];

export function nextCiPoll(
  startedAtMs: number,
  lastDelayMs: number | null,
  nowMs: number,
): number | null {
  if (nowMs - startedAtMs >= CI_WATCH_LIMIT_MS) return null;
  if (lastDelayMs === null) return CI_POLL_FIRST_MS;
  return Math.min(lastDelayMs * 2, CI_POLL_MAX_MS);
}

export function refreshReason(stdout: string): string | null {
  const line = stdout.trim().split('\n').at(-1) ?? '';
  try {
    const parsed = JSON.parse(line) as { reason?: unknown };
    return typeof parsed.reason === 'string' ? parsed.reason : null;
  } catch {
    return null;
  }
}

export function stopsCiWatch(reason: string | null): boolean {
  return reason !== null && WATCH_ENDING_REASONS.includes(reason);
}

export function ciWatchHead(snapshot: PaqadHudSnapshot | null): string | null {
  const ship = snapshot?.active === true ? snapshot.ship : null;
  if (!ship || ship.pr_state !== 'open') return null;
  if (ship.ci_detail?.state !== 'pending') return null;
  return ship.pr_head ?? '';
}

export function withCiPause(
  snapshot: PaqadHudSnapshot | null,
  reason: string | null,
): PaqadHudSnapshot | null {
  if (!snapshot || reason === null) return snapshot;
  const note = `${CI_PAUSED_PREFIX}${reason}`;
  const gap = snapshot.headline.gap ? `${snapshot.headline.gap} · ${note}` : note;
  return { ...snapshot, headline: { ...snapshot.headline, gap } };
}

export function isGitPush(tool: string, command: unknown): boolean {
  return tool === 'Bash' && typeof command === 'string' && /\bgit\s+push\b/.test(command);
}
