import { IDLE_LIVE, type LiveState } from './live';
import type { PaqadHudSnapshot } from './types';

export type ShipLabel = 'Edit' | 'Commit' | 'Push' | 'PR' | 'CI' | 'Merge';

export type ShipStepState = 'done' | 'current' | 'todo' | 'failed' | 'closed' | 'ready' | 'unknown';

export interface ShipRailStep {
  label: ShipLabel;
  state: ShipStepState;
}

export interface ShipRail {
  steps: ShipRailStep[];
  status: string | null;
  inherited: number;
  ci: { done: number; total: number } | null;
  allGreen: boolean;
  prNumber: number | null;
  merged: boolean;
}

const EDIT_STAGE_IDS = ['development', 'checks', 'documentation_sync'];

function editState(snapshot: PaqadHudSnapshot | null, live: LiveState): ShipStepState {
  const stateOf = (id: string) => snapshot?.stages.find((stage) => stage.stage === id)?.state;
  const open = EDIT_STAGE_IDS.some((id) => stateOf(id) === 'running');
  if (live.editing !== null || open) return 'current';
  if (EDIT_STAGE_IDS.some((id) => stateOf(id) === 'complete' || stateOf(id) === 'redone')) {
    return 'done';
  }
  return 'todo';
}

function prLabel(number: number | null): string {
  return number === null ? 'PR' : `PR #${number}`;
}

function ciState(hasPr: boolean, closed: boolean, state: string | null): ShipStepState {
  if (!hasPr || closed || state === null) return 'todo';
  if (state === 'pass') return 'done';
  if (state === 'fail') return 'failed';
  return state === 'pending' ? 'current' : 'unknown';
}

export function shipRail(snapshot: PaqadHudSnapshot | null, live: LiveState = IDLE_LIVE): ShipRail {
  const active = snapshot?.active === true;
  const ship = active ? (snapshot?.ship ?? null) : null;
  const commits = ship?.commits ?? 0;
  const prState = ship?.pr_state ?? null;
  const hasPr = ship !== null && ship.pr_number !== null && ship.pr !== null;
  const ci = ship?.ci_detail ?? null;
  const ciCount =
    ci && ci.total !== null && ci.total > 0 ? { done: ci.done ?? 0, total: ci.total } : null;
  const merged = ship?.merged === true;
  const allGreen = ship?.all_green === true && !merged;
  const steps: ShipRailStep[] = [
    { label: 'Edit', state: active ? editState(snapshot, live) : 'todo' },
    { label: 'Commit', state: commits > 0 ? 'done' : 'todo' },
    {
      label: 'Push',
      state: ship?.push === 'pushed' ? 'done' : ship?.push === 'failed' ? 'failed' : 'todo',
    },
    { label: 'PR', state: !hasPr ? 'todo' : prState === 'closed' ? 'closed' : 'done' },
    { label: 'CI', state: ciState(hasPr, prState === 'closed', ci?.state ?? null) },
    {
      label: 'Merge',
      state: merged ? 'done' : allGreen ? 'ready' : hasPr && prState === null ? 'unknown' : 'todo',
    },
  ];
  const number = ship?.pr_number ?? null;
  return {
    steps,
    status: railStatus(steps, commits, number, ciCount, allGreen, merged),
    inherited: ship ? Math.max(ship.inherited_count, 0) : 0,
    ci: ciCount,
    allGreen,
    prNumber: number,
    merged,
  };
}

function railStatus(
  steps: readonly ShipRailStep[],
  commits: number,
  number: number | null,
  ci: { done: number; total: number } | null,
  allGreen: boolean,
  merged: boolean,
): string | null {
  const state = (label: ShipLabel) => steps.find((step) => step.label === label)!.state;
  if (merged) return `${prLabel(number)} merged`;
  if (allGreen) return 'All green · merge is yours';
  if (state('PR') === 'closed') return 'PR closed';
  if (state('CI') === 'failed') return 'CI failed';
  if (state('CI') === 'current' || state('CI') === 'done') {
    return ci ? `CI · ${ci.done} of ${ci.total} green` : 'CI running';
  }
  if (state('PR') === 'done') return prLabel(number);
  if (state('Push') === 'failed') return 'push failed';
  if (state('Push') === 'done') return 'pushed';
  if (commits > 0) return `${commits} of your commit${commits === 1 ? '' : 's'}`;
  if (state('Edit') === 'current') return 'editing';
  if (state('Edit') === 'done') return 'edited';
  return null;
}

export const STEP_WORDS: Record<ShipStepState, string> = {
  done: 'done',
  current: 'running',
  todo: 'not yet',
  failed: 'failed',
  closed: 'closed',
  ready: 'ready, yours to merge',
  unknown: 'unknown',
};

export function railAlt(rail: ShipRail): string {
  const words = rail.steps.map((step) => {
    if (step.label === 'CI' && rail.ci && step.state !== 'todo') {
      return `CI ${rail.ci.done} of ${rail.ci.total} green`;
    }
    return `${step.label} ${STEP_WORDS[step.state]}`;
  });
  return `Ship: ${words.join(', ')}.`;
}

const COLOR = {
  done: '#2e9d5b',
  current: '#3b7dd8',
  todo: '#9a9a9a',
  bad: '#d0573f',
  ready: '#7cc79a',
  face: 'white',
  label: 'gray',
} as const;

function stepColor(state: ShipStepState): string {
  if (state === 'done') return COLOR.done;
  if (state === 'current') return COLOR.current;
  if (state === 'failed' || state === 'closed') return COLOR.bad;
  if (state === 'ready') return COLOR.ready;
  return COLOR.todo;
}

const ICONS: Record<ShipLabel, string> = {
  Edit: 'M-6 6 L4 -4 L6 -2 L-4 8 Z M-6 6 L-7 9 L-4 8',
  Commit: 'M-9 0 H-4 M4 0 H9 M0 -4 A4 4 0 1 0 0.01 -4',
  Push: 'M0 8 V-7 M-5 -2 L0 -7 L5 -2',
  PR: 'M-5 -7 V7 M5 -3 V7 M5 -3 C5 -8 0 -8 -2 -8 M-4 -10 L-2 -8 L-4 -6',
  CI: 'M-6 0 L-2 5 L7 -6',
  Merge: 'M-5 -8 V8 M-5 -2 C-5 4 5 2 5 8',
};

const escapeXml = (text: string): string =>
  text.replace(/[<>&"']/g, (char) => `&#${char.charCodeAt(0)};`);

export const RAIL_WIDTH = 360;
export const RAIL_HEIGHT = 64;

export function shipRailSvg(rail: ShipRail): { source: string; alt: string } {
  const step = RAIL_WIDTH / rail.steps.length;
  const y = 26;
  const x = (index: number) => step / 2 + index * step;
  const lastDone = rail.steps.reduce(
    (last, entry, index) => (entry.state === 'done' ? index : last),
    -1,
  );
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${RAIL_WIDTH} ${RAIL_HEIGHT}" width="${RAIL_WIDTH}" height="${RAIL_HEIGHT}">`,
    `<line x1="${x(0)}" y1="${y}" x2="${x(rail.steps.length - 1)}" y2="${y}" stroke="${COLOR.todo}" stroke-width="2"/>`,
  ];
  if (lastDone > 0) {
    parts.push(
      `<line x1="${x(0)}" y1="${y}" x2="${x(lastDone)}" y2="${y}" stroke="${COLOR.done}" stroke-width="3"/>`,
    );
  }
  rail.steps.forEach((entry, index) => {
    const color = stepColor(entry.state);
    const cx = x(index);
    parts.push(
      `<g transform="translate(${cx} ${y})"><title>${escapeXml(`${entry.label} ${STEP_WORDS[entry.state]}`)}</title>`,
      `<circle r="13" fill="${COLOR.face}" stroke="${color}" stroke-width="2"/>`,
      `<path d="${ICONS[entry.label]}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
    if (entry.label === 'CI' && rail.ci) {
      const share = Math.min(1, Math.max(0, rail.ci.done / rail.ci.total));
      const radius = 17;
      const length = 2 * Math.PI * radius;
      parts.push(
        `<circle r="${radius}" fill="none" stroke="${COLOR.todo}" stroke-width="3"/>`,
        `<circle r="${radius}" fill="none" stroke="${COLOR.done}" stroke-width="3" stroke-dasharray="${(length * share).toFixed(2)} ${length.toFixed(2)}" transform="rotate(-90)"/>`,
      );
    }
    parts.push(
      '</g>',
      `<text x="${cx}" y="${RAIL_HEIGHT - 6}" text-anchor="middle" font-size="11" fill="${COLOR.label}">${entry.label}</text>`,
    );
  });
  parts.push('</svg>');
  return { source: parts.join(''), alt: railAlt(rail) };
}
