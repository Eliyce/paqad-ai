import { STAGE_MARK } from './instruments';
import {
  ONBOARDING_WORD,
  STALL_MS,
  journeyBand,
  type JourneyStageState,
  type JourneyView,
  type JourneyViewStage,
} from './journey-model';
import type { SegmentState } from './model';
import {
  BRAND,
  ROW_LAYOUT_COLUMNS,
  registerBandBody,
  type BandBlock,
  type BandBody,
  type BandCell,
  type BandRow,
  type BodyContext,
  type ShellHeader,
} from './shell';
import { workflowCost } from './status-entry';
import type { PaqadHudSnapshot, PaqadTone } from './types';

export const ONBOARDING_ROUTE = 'onboarding';
export const CONTINUE_WORDS = 'say "continue paqad onboarding"';
export const COMMIT_LATER =
  'Commit on a new branch? answer above, or run paqad-ai onboarding commit';
export const WAITING_FOR_COMMIT =
  '● Waiting for your answer · commit these changes on a new branch?';
export const WRAP_CELLS = 4;
export const LEDGER_WORD = 'Ledger';

const CELL_STATE: Readonly<Record<JourneyStageState, SegmentState>> = {
  done: 'done',
  running: 'running',
  todo: 'not yet',
  failed: 'failed',
  degraded: 'marked',
};

export function journeyStalled(view: JourneyView, now: number): boolean {
  if (view.status !== 'running') return false;
  const at = view.generated_at ? Date.parse(view.generated_at) : Number.NaN;
  return Number.isFinite(at) && now - at > STALL_MS;
}

function stopped(view: JourneyView, stalled: boolean): boolean {
  return view.status === 'stopped' || (stalled && view.status === 'running');
}

export function journeyCardTone(view: JourneyView, stalled: boolean): PaqadTone {
  if (stopped(view, stalled)) return 'bad';
  if (view.status === 'paused' || view.status === 'asking_commit') return 'needs-you';
  if (view.status === 'done_with_gaps') return 'warn';
  if (view.status === 'done') return 'good';
  return 'working';
}

export function focusStage(view: JourneyView): JourneyViewStage | null {
  return (
    view.stages.find((stage) => stage.state === 'running' || stage.state === 'failed') ??
    view.stages.find((stage) => stage.id === view.current) ??
    null
  );
}

export function journeyStepWords(view: JourneyView): string {
  if (view.status === 'done' || view.status === 'asking_commit') return 'done';
  if (view.status === 'done_with_gaps') return 'done with gaps';
  const focus = focusStage(view);
  return focus ? `Step ${focus.index} of ${view.stages.length}` : 'not started';
}

export function journeyStateLine(view: JourneyView, stalled: boolean): BandRow {
  const focus = focusStage(view);
  const name = focus?.name ?? '';
  const sub = focus?.sub_progress ?? null;
  if (stopped(view, stalled)) {
    const at = sub && sub.total !== null ? ` at ${sub.done} of ${sub.total}` : '';
    return [{ text: `✗ ${name} stopped${at} · ${CONTINUE_WORDS}`, tone: 'bad' }];
  }
  if (view.status === 'paused') {
    return [{ text: `● Paused before ${name} · ${CONTINUE_WORDS}`, tone: 'needs-you' }];
  }
  if (view.status === 'asking_commit') return [{ text: WAITING_FOR_COMMIT, tone: 'needs-you' }];
  if (view.status === 'done_with_gaps') return [{ text: `◐ ${view.headline.text}`, tone: 'warn' }];
  if (view.status === 'done') return [{ text: `✓ ${view.headline.text}`, tone: 'good' }];
  if (view.status === 'running' && focus) {
    const row: BandRow = [{ text: `▸ ${focus.running}`, tone: 'working' }];
    if (sub?.words) row.push({ text: `  ${sub.words}`, dim: true });
    return row;
  }
  return [{ text: `○ ${view.headline.text}`, dim: true }];
}

export function journeyNote(view: JourneyView, columns: number, stalled: boolean): string | null {
  if (view.status === 'asking_commit') return COMMIT_LATER;
  if (view.status === 'done_with_gaps') {
    return view.gaps.map((gap) => gap.footnote).join(' ') || null;
  }
  const model = journeyBand(view, { columns, stalled });
  return model.note ?? model.eta.eta;
}

export function journeyCells(view: JourneyView): BandCell[] {
  return view.stages.map((stage) => {
    const look = STAGE_MARK[CELL_STATE[stage.state]];
    return {
      key: `paqad-onboarding-${stage.id}`,
      top: {
        text: look.mark,
        ...(look.tone ? { tone: look.tone } : {}),
        ...(look.dim ? { dim: true } : {}),
      },
      bottom: { text: stage.label, dim: stage.state === 'todo' },
    };
  });
}

export function journeyHeader(
  snapshot: PaqadHudSnapshot | null,
  view: JourneyView,
  stalled: boolean,
): ShellHeader {
  const workflow = snapshot?.workflow?.name === ONBOARDING_ROUTE ? snapshot.workflow : null;
  return {
    tone: journeyCardTone(view, stalled),
    chip: null,
    headline: `${ONBOARDING_WORD} · ${journeyStepWords(view)}`,
    note: null,
    gap: null,
    activity: [],
    verdict: null,
    flags: 0,
    lane: null,
    tokens: workflowCost(workflow),
  };
}

export function journeyLine(view: JourneyView, stalled: boolean): BandRow {
  const tone = journeyCardTone(view, stalled);
  return [
    { text: BRAND, tone, opens: 'trust', key: 'paqad-brand' },
    { text: `  ${ONBOARDING_WORD} · ${journeyStepWords(view)}  `, dim: true },
    ...journeyStateLine(view, stalled),
  ];
}

const EMPTY_BODY: BandBody = { blocks: [], footer: null };

export function onboardingBody(_snapshot: PaqadHudSnapshot | null, context: BodyContext): BandBody {
  const view = context.journey ?? null;
  if (view === null) return EMPTY_BODY;
  const columns = context.columns ?? ROW_LAYOUT_COLUMNS;
  const stalled = journeyStalled(view, context.now);
  const note = journeyNote(view, columns, stalled);
  const noteRow: BandRow | null = note ? [{ text: note, dim: true }] : null;
  const cells = journeyCells(view);
  const title = journeyStateLine(view, stalled);
  const blocks: BandBlock[] =
    columns >= ROW_LAYOUT_COLUMNS
      ? [{ key: 'paqad-onboarding-steps', title, cells, svg: null, note: noteRow }]
      : [
          {
            key: 'paqad-onboarding-steps',
            title,
            cells: cells.slice(0, WRAP_CELLS),
            svg: null,
            note: null,
          },
          {
            key: 'paqad-onboarding-steps-more',
            title: [{ text: `Steps ${WRAP_CELLS + 1} to ${cells.length}`, dim: true }],
            cells: cells.slice(WRAP_CELLS),
            svg: null,
            note: noteRow,
          },
        ];
  const done = view.status === 'done' || view.status === 'done_with_gaps';
  return {
    blocks,
    footer: {
      left: [{ text: LEDGER_WORD, dim: true, opens: 'trust', key: 'paqad-onboarding-ledger' }],
      right: done || !view.estimate ? [] : [{ text: view.estimate, dim: true }],
    },
  };
}

registerBandBody(ONBOARDING_ROUTE, onboardingBody);
