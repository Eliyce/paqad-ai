import { IDLE_LIVE, type LiveState } from './live';
import type { PaqadHudSnapshot } from './types';

export function waitingOnHuman(
  snapshot: PaqadHudSnapshot | null,
  live: LiveState = IDLE_LIVE,
): boolean {
  return live.waitingOn !== null || (snapshot?.decisions.pending.length ?? 0) > 0;
}

export function verdictFromEarlierTurn(
  snapshot: PaqadHudSnapshot,
  live: LiveState = IDLE_LIVE,
): boolean {
  const writtenAt = snapshot.verdict?.at ? Date.parse(snapshot.verdict.at) : Number.NaN;
  return (
    live.turnId !== null &&
    live.turnStartedAt !== null &&
    Number.isFinite(writtenAt) &&
    writtenAt < live.turnStartedAt
  );
}
