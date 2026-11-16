import type { Mark, StageState } from './strip';
import type { JourneyStageState, JourneyView, JourneyViewStage } from './types';

export type { JourneyStageState, JourneyView, JourneyViewStage };

export const ONBOARDING_WORD = 'Onboarding';
export const JOURNEY_VIEW_PATH = '.paqad/onboarding/view.json';
export const JOURNEY_RUN_PATH = '.paqad/onboarding/journey.json';
export const NARROW_COLUMNS = 680;
export const STALL_MS = 20 * 60 * 1000;
export const REVIEW_VIEW_PATHS: Readonly<Record<string, string>> = {
  pentest: '.paqad/reviews/security/view.json',
  'design-test': '.paqad/reviews/design/view.json',
};

export type JourneyRow = 'O1' | 'O2' | 'O3' | 'O4' | 'O5' | 'O6' | 'P' | 'S';
export type JourneySignal = 'caution' | 'accent' | 'attention' | 'muted' | 'pass' | 'fail';

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
  skipped: 'skip',
  gap: 'gap',
};

export function isReviewView(view: JourneyView | null): boolean {
  return typeof view?.word === 'string';
}

export function journeyWord(view: JourneyView): string {
  return view.word ?? ONBOARDING_WORD;
}

export function journeyHeartbeat(view: JourneyView): number {
  const at = view.updated_at ?? view.generated_at;
  return at ? Date.parse(at) : Number.NaN;
}

export function journeyMarks(view: JourneyView, asking: boolean): Array<Mark<StageState>> {
  return view.stages.map((stage) => ({
    label: stage.label,
    state: asking && stage.id === 'finish' ? 'paused' : STATE_OF[stage.state],
  }));
}

export function stageValue(stage: JourneyViewStage): string {
  if (stage.state === 'failed') return `${stage.label} stopped`;
  if (stage.state === 'degraded') return `${stage.label} · ${stage.gaps.join(', ')}`;
  if (stage.state === 'skipped') return `${stage.label} skipped`;
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

function reviewHeadline(view: JourneyView, stalled: boolean): JourneyHeadline {
  if (stalled && view.status === 'running') {
    const current = view.stages.find((stage) => stage.id === view.current);
    return {
      row: 'S',
      text: `Stopped at stage ${current?.index ?? '?'} · ${current?.name ?? ''} · Resume to continue`,
      signal: 'caution',
    };
  }
  return {
    row: view.headline.row as JourneyRow,
    text: view.headline.text,
    signal: view.headline.signal ?? 'muted',
  };
}

export function journeyHeadline(view: JourneyView, stalled: boolean): JourneyHeadline {
  if (isReviewView(view)) return reviewHeadline(view, stalled);
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
  word: string;
  review: boolean;
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
  prompt: string | null;
  leads: string | null;
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
  const review = isReviewView(view);
  const allDone = view.stages.every((stage) =>
    review
      ? stage.state === 'done' || stage.state === 'skipped' || stage.state === 'gap'
      : stage.state === 'done' || stage.state === 'degraded',
  );
  const button = headline.row === 'S' ? 'Resume' : view.button;
  return {
    word: journeyWord(view),
    review,
    runId: view.run_id,
    headline,
    marks: journeyMarks(view, asking),
    value: allDone
      ? review
        ? 'All stages done'
        : 'All steps done'
      : focus
        ? stageValue(focus)
        : '',
    alt: view.alt,
    button,
    eta: journeyEta(view, input.columns),
    gaps: view.gaps,
    celebrate: !review && view.celebrate && view.gaps.length === 0,
    note: view.refusal ?? view.uncommitted_note,
    prompt: button ? journeyPrompt(button, view) : null,
    leads: view.leads_note ?? null,
  };
}

export function skipsSubagentRow(view: JourneyView | null): boolean {
  return view !== null && view.stages.some((stage) => stage.state === 'running');
}

export const FINISH_SCREEN_MS = 30 * 60 * 1000;
export const RESUME_PROMPT = 'resume paqad onboarding';
export const COMMIT_PROMPT = 'Ask me the paqad onboarding commit question now.';

const REVIEW_ENDED: ReadonlySet<string> = new Set(['finished', 'abandoned']);

export function journeyBandShown(view: JourneyView | null, nowMs: number): boolean {
  if (view !== null && isReviewView(view)) {
    if (!REVIEW_ENDED.has(view.status)) return true;
    const ended = view.finished_at ? Date.parse(view.finished_at) : Number.NaN;
    return Number.isFinite(ended) && nowMs - ended < FINISH_SCREEN_MS;
  }
  if (view === null || view.status === 'not_started') return false;
  if (view.status !== 'done' && view.status !== 'done_with_gaps') return true;
  const at = view.generated_at ? Date.parse(view.generated_at) : Number.NaN;
  return Number.isFinite(at) && nowMs - at <= FINISH_SCREEN_MS;
}

export function journeyPrompt(button: 'Resume' | 'Commit', view?: JourneyView): string {
  if (button === 'Resume') return view?.resume_prompt ?? RESUME_PROMPT;
  return COMMIT_PROMPT;
}

export function newestShown(
  views: ReadonlyArray<JourneyView | null>,
  nowMs: number,
): JourneyView | null {
  const shown = views.filter(
    (view): view is JourneyView => view !== null && journeyBandShown(view, nowMs),
  );
  shown.sort((a, b) => (journeyHeartbeat(b) || 0) - (journeyHeartbeat(a) || 0));
  return shown[0] ?? null;
}

export const ONBOARDING_COMMAND = /\bpaqad-ai\s+onboard(?:ing)?\b/u;
export const BIND_WATCH_MS = 10 * 60 * 1000;

export function isOnboardingCommand(tool: string, input: { command?: unknown }): boolean {
  return (
    tool === 'Bash' && typeof input.command === 'string' && ONBOARDING_COMMAND.test(input.command)
  );
}

export interface RootBinding {
  on: boolean;
  root: string | null;
}

function trimmedRoot(root: string | null): string | null {
  return root === null ? null : root.replace(/[\\/]+$/, '') || root;
}

export function rebindNeeded(before: RootBinding, after: RootBinding): boolean {
  if (before.on !== after.on) return true;
  return after.on && trimmedRoot(before.root) !== trimmedRoot(after.root);
}
