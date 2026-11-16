import type { Mark, StageState } from './strip';

export const ONBOARDING_WORD = 'Onboarding';
export const JOURNEY_VIEW_PATH = '.paqad/onboarding/view.json';
export const JOURNEY_RUN_PATH = '.paqad/onboarding/journey.json';
export const NARROW_COLUMNS = 680;

export type JourneyStageState = 'todo' | 'running' | 'done' | 'degraded' | 'failed';
export type JourneyRow = 'O1' | 'O2' | 'O3' | 'O4' | 'O5' | 'O6' | 'P' | 'S';
export type JourneySignal = 'caution' | 'accent' | 'attention' | 'muted' | 'pass';

export interface JourneyViewStage {
  id: string;
  index: number;
  name: string;
  label: string;
  running: string;
  state: JourneyStageState;
  mark: string;
  sub_progress: {
    done: number;
    total: number | null;
    current: string | null;
    words: string;
    eta_minutes: number | null;
  } | null;
  gaps: string[];
}

export interface JourneyView {
  run_id: string | null;
  status: string;
  headline: { row: string; text: string };
  status_line: string | null;
  stages: JourneyViewStage[];
  current: string | null;
  alt: string;
  gaps: Array<{ code: string; stage: string; footnote: string; next_action: string }>;
  button: 'Resume' | 'Commit' | null;
  celebrate: boolean;
  uncommitted_note: string | null;
  refusal: string | null;
}

export function parseJourneyView(text: string | null): JourneyView | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Partial<JourneyView>;
    if (!Array.isArray(value.stages) || typeof value.status !== 'string' || !value.headline) {
      return null;
    }
    return value as JourneyView;
  } catch {
    return null;
  }
}

const STATE_OF: Readonly<Record<JourneyStageState, StageState>> = {
  todo: 'todo',
  running: 'run',
  done: 'done',
  degraded: 'gap',
  failed: 'stopped',
};

export function journeyMarks(view: JourneyView, asking: boolean): Array<Mark<StageState>> {
  return view.stages.map((stage) => ({
    label: stage.label,
    state: asking && stage.id === 'finish' ? 'paused' : STATE_OF[stage.state],
  }));
}

export function stageValue(stage: JourneyViewStage): string {
  if (stage.state === 'failed') return `${stage.label} stopped`;
  if (stage.state === 'degraded') return `${stage.label} · ${stage.gaps.join(', ')}`;
  const words = stage.sub_progress?.words;
  return words ? `${stage.label} · ${words}` : stage.label;
}

export interface JourneyHeadline {
  row: JourneyRow;
  text: string;
  signal: JourneySignal;
}

const SIGNAL_OF: Readonly<Record<string, JourneySignal>> = {
  O1: 'caution',
  O2: 'accent',
  O3: 'attention',
  O4: 'muted',
  O5: 'pass',
  O6: 'muted',
};

export function journeyHeadline(view: JourneyView, stalled: boolean): JourneyHeadline {
  if (view.status === 'paused') {
    return { row: 'P', text: view.headline.text, signal: 'caution' };
  }
  if (stalled && view.status === 'running') {
    const current = view.stages.find((stage) => stage.id === view.current);
    return {
      row: 'S',
      text: `Stopped at step ${current?.index ?? '?'} · ${current?.name ?? ''} · Resume to continue`,
      signal: 'caution',
    };
  }
  const row = (view.headline.row as JourneyRow) ?? 'O6';
  return { row, text: view.headline.text, signal: SIGNAL_OF[row] ?? 'muted' };
}

export interface JourneyNote {
  eta: string | null;
  etaInNote: boolean;
}

export function journeyEta(view: JourneyView, columns: number): JourneyNote {
  const running = view.stages.find((stage) => stage.state === 'running');
  const minutes = running?.sub_progress?.eta_minutes ?? null;
  if (minutes === null) return { eta: null, etaInNote: false };
  const eta =
    minutes >= 60 ? `about ${Math.round(minutes / 60)} h left` : `about ${minutes} min left`;
  return { eta, etaInNote: columns < NARROW_COLUMNS };
}

export interface JourneyBandModel {
  word: typeof ONBOARDING_WORD;
  runId: string | null;
  headline: JourneyHeadline;
  marks: Array<Mark<StageState>>;
  value: string;
  alt: string;
  button: 'Resume' | 'Commit' | null;
  eta: JourneyNote;
  gaps: JourneyView['gaps'];
  celebrate: boolean;
  note: string | null;
}

export function journeyBand(
  view: JourneyView,
  input: { columns: number; stalled: boolean },
): JourneyBandModel {
  const asking = view.status === 'asking_commit';
  const headline = journeyHeadline(view, input.stalled);
  const focus =
    view.stages.find((stage) => stage.state === 'running' || stage.state === 'failed') ??
    view.stages.find((stage) => stage.id === view.current) ??
    null;
  const allDone = view.stages.every(
    (stage) => stage.state === 'done' || stage.state === 'degraded',
  );
  const button = headline.row === 'S' ? 'Resume' : view.button;
  return {
    word: ONBOARDING_WORD,
    runId: view.run_id,
    headline,
    marks: journeyMarks(view, asking),
    value: allDone ? 'All steps done' : focus ? stageValue(focus) : '',
    alt: view.alt,
    button,
    eta: journeyEta(view, input.columns),
    gaps: view.gaps,
    celebrate: view.celebrate && view.gaps.length === 0,
    note: view.refusal ?? view.uncommitted_note,
  };
}

export function skipsSubagentRow(view: JourneyView | null): boolean {
  return view !== null && view.stages.some((stage) => stage.state === 'running');
}
