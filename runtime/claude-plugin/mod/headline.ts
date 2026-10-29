import { formatStopwatch } from './cost';
import { IDLE_LIVE, type LiveState } from './live';
import type { Signal } from './palette';
import type { PaqadHudSnapshot, PaqadTone } from './types';

export const WAITING_FOR_ANSWER = 'Waiting for your answer';
export const NO_RECORD = 'Not yet. paqad has no record for this session.';

export interface DesktopHeadline {
  row: number;
  signal: Signal;
  tone: PaqadTone;
  live: boolean;
  text: string;
  word: string | null;
  note: string | null;
  gap: string | null;
  clock: string | null;
}

const TONE_SIGNAL: Readonly<Record<PaqadTone, Signal>> = {
  neutral: 'idle',
  working: 'accent',
  'needs-you': 'attention',
  good: 'pass',
  warn: 'caution',
  bad: 'fail',
};

function waitingRow(row: number, text: string): DesktopHeadline {
  return {
    row,
    signal: 'attention',
    tone: 'needs-you',
    live: false,
    text,
    word: WAITING_FOR_ANSWER,
    note: null,
    gap: null,
    clock: null,
  };
}

export function snapshotHeadline(
  snapshot: PaqadHudSnapshot,
  now: number,
  live: LiveState = IDLE_LIVE,
): DesktopHeadline {
  if (live.waitingOn === 'question') return waitingRow(3, WAITING_FOR_ANSWER);
  if (live.waitingOn === 'permission') return waitingRow(4, WAITING_FOR_ANSWER);
  const head = snapshot.headline;
  const running = head.tone === 'working';
  const from = head.clock_from ? Date.parse(head.clock_from) : Number.NaN;
  return {
    row: head.row ?? 0,
    signal: TONE_SIGNAL[head.tone],
    tone: head.tone,
    live: running,
    text: head.text || NO_RECORD,
    word: head.word ?? null,
    note: head.note ?? null,
    gap: head.gap ?? null,
    clock: running && Number.isFinite(from) ? formatStopwatch(now - from) : null,
  };
}

export function judgedHeadline(snapshot: PaqadHudSnapshot | null): boolean {
  return typeof snapshot?.headline.row === 'number';
}
