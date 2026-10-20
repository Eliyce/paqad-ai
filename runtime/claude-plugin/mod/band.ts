import { formatTokens } from './cost';
import './instruments';
import { buildBandView, headlineAfterState, type BandView } from './model';
import {
  BAND_BODIES,
  layoutShell,
  type BandLayout,
  type BandRow,
  type BandSegment,
  type BodyContext,
  type ShellHeader,
} from './shell';
import { shipRail } from './ship';
import { NO_WORKFLOW, statusEntryRoute, statusEntryRow } from './status-entry';
import {
  IDLE_WORDS,
  closedLine,
  minimisedLine,
  needsYou,
  needsYouLine,
  visibilityMode,
  type BandVisibility,
} from './visibility';
import type { PaqadHudSnapshot, PaqadTone } from './types';

export type { BandLayout, BandRow, BandSegment };

const ELLIPSIS = '…';

export const FEATURE_DEVELOPMENT = 'feature-development';
export const IDLE_HEADLINE = IDLE_WORDS;

export function rowText(row: BandRow): string {
  return row.map((segment) => segment.text).join('');
}

export function truncateRow(row: BandRow, columns: number): BandRow {
  const width = Math.max(1, Math.floor(columns));
  if ([...rowText(row)].length <= width) return row;
  const out: BandRow = [];
  let room = width - 1;
  for (const segment of row) {
    if (room <= 0) break;
    const chars = [...segment.text];
    const text = chars.slice(0, room).join('');
    out.push({ ...segment, text });
    room -= chars.length;
  }
  out.push({ text: ELLIPSIS });
  return out.filter((segment) => segment.text.length > 0);
}

export function changeChip(snapshot: PaqadHudSnapshot | null): string | null {
  const change = snapshot?.active ? snapshot.change : null;
  if (!change) return null;
  if (change.issue) return /^\d+$/.test(change.issue) ? `#${change.issue}` : change.issue;
  return change.id ? change.id.slice(-6) : null;
}

export function tokensChip(snapshot: PaqadHudSnapshot | null): string | null {
  const cost = snapshot?.active ? snapshot.cost : null;
  if (!cost) return null;
  const tokens = `${formatTokens(cost.tokens.total)} tokens`;
  return cost.scope === 'whole-session' ? `${tokens} · whole session` : tokens;
}

const VERDICT_TONE: Record<'pass' | 'fail' | 'inconclusive', PaqadTone> = {
  pass: 'good',
  fail: 'bad',
  inconclusive: 'warn',
};

export function allGreenNow(snapshot: PaqadHudSnapshot | null): boolean {
  return (
    snapshot?.active === true &&
    snapshot.decisions.pending.length === 0 &&
    shipRail(snapshot).allGreen
  );
}

export function allGreenKey(snapshot: PaqadHudSnapshot | null): string | null {
  if (!allGreenNow(snapshot)) return null;
  const change = snapshot?.change?.dir ?? snapshot?.change?.id ?? 'change';
  return `${change}:${snapshot?.ship?.pr_head ?? 'head'}`;
}

export function bandHeadline(snapshot: PaqadHudSnapshot, view: BandView): string {
  if (allGreenNow(snapshot)) {
    const number = snapshot.ship?.pr_number ?? null;
    return `All green: ${number === null ? 'the PR' : `PR #${number}`} is ready for your merge`;
  }
  if (snapshot.decisions.pending.length > 0 || !snapshot.verdict) return view.headline;
  const required = snapshot.gates.filter(
    (gate) => gate.required && gate.verdict !== 'not-required',
  );
  if (required.length === 0) return headlineAfterState(view) || view.headline;
  const passed = required.filter((gate) => gate.verdict === 'pass').length;
  return `${passed} of ${required.length} required gates pass`;
}

export function shellHeader(snapshot: PaqadHudSnapshot | null, view: BandView): ShellHeader {
  const active = snapshot?.active === true;
  const verdict = active ? (snapshot?.verdict ?? null) : null;
  return {
    tone: active ? (allGreenNow(snapshot) ? 'good' : view.tone) : 'neutral',
    chip: changeChip(snapshot),
    headline: snapshot && active ? bandHeadline(snapshot, view) : IDLE_HEADLINE,
    verdict: verdict ? { word: verdict.word, tone: VERDICT_TONE[verdict.kind] } : null,
    flags: active ? view.flags : 0,
    lane: active ? (snapshot?.lane ?? null) : null,
    tokens: tokensChip(snapshot),
  };
}

const SHOWN: BandVisibility = { minimised: false, closed: false, hidden: false };

export function layoutBand(
  snapshot: PaqadHudSnapshot | null,
  size: { columns: number; maxRows: number },
  context: BodyContext,
  visibility: BandVisibility = SHOWN,
): BandLayout {
  if (snapshot && (snapshot.route === null || snapshot.route === NO_WORKFLOW)) {
    return { kind: 'none' };
  }
  const entryRoute = statusEntryRoute(snapshot);
  if (snapshot && entryRoute) {
    return {
      kind: 'line',
      row: statusEntryRow(snapshot, entryRoute, context.now, context.turnStartedAt ?? null),
    };
  }
  const view = buildBandView(snapshot, context.now);
  const mode = visibilityMode(visibility);
  if (mode !== 'band' && needsYou(snapshot)) return { kind: 'line', row: needsYouLine() };
  if (mode === 'closed' || mode === 'hidden') {
    return { kind: 'line', row: closedLine(mode, view) };
  }
  const minimised = minimisedLine(snapshot, view, size.columns, context.now);
  if (mode === 'minimised') return { kind: 'line', row: minimised };
  const active = snapshot?.active === true;
  const route = snapshot?.route ?? FEATURE_DEVELOPMENT;
  const renderer = active ? BAND_BODIES[route] : undefined;
  const body = snapshot && renderer ? renderer(snapshot, context) : null;
  return layoutShell(shellHeader(snapshot, view), body, size, minimised);
}

const SPINNER_WORDS: Record<string, string> = {
  ticket_intake: 'Reading the ticket',
  planning: 'Planning',
  specification: 'Writing the spec',
  development: 'Building',
  review: 'Reviewing',
  checks: 'Running checks',
  documentation_sync: 'Syncing the docs',
  delivery: 'Delivering',
};

export function spinnerWord(snapshot: PaqadHudSnapshot | null): string | null {
  if (!snapshot?.active) return null;
  const running = snapshot.stages.find((stage) => stage.state === 'running');
  return running ? (SPINNER_WORDS[running.stage] ?? null) : null;
}

export function laneMode(snapshot: PaqadHudSnapshot | null): string | null {
  return snapshot?.active && snapshot.lane ? `paqad ${snapshot.lane} lane` : null;
}
