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

export const CI_POLL_MS = 30_000;
export const CI_WATCH_LIMIT_MS = 3_600_000;
export const CI_WATCH_TIMED_OUT = 'time limit';
export const CI_PAUSED_PREFIX = 'CI updates paused: ';

const NOT_A_GH_FAILURE: readonly string[] = ['fresh', 'no pull request for this branch'];

export function nextCiPoll(startedAtMs: number, nowMs: number): number | null {
  return nowMs - startedAtMs >= CI_WATCH_LIMIT_MS ? null : CI_POLL_MS;
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

export function pauseReason(reason: string | null): 'signed out' | 'offline' | null {
  if (reason === null || NOT_A_GH_FAILURE.includes(reason)) return null;
  if (reason === 'gh is signed out') return 'signed out';
  return reason.startsWith('gh ') ? 'offline' : null;
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
