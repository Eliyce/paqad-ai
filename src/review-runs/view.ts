import type { ReviewKind, ReviewStageDefinition } from './kinds.js';
import {
  OPEN_STATUSES,
  SERIOUS,
  SEVERITIES,
  type ReviewRun,
  type ReviewStageStatus,
  type Severity,
} from './types.js';

export const STALL_MS = 20 * 60 * 1000;
export const FINISH_SCREEN_MS = 30 * 60 * 1000;

export type ReviewViewStatus =
  'not_started' | 'running' | 'between' | 'stopped' | 'abandoned' | 'finished';

export type ReviewHeadlineRow = 'R0' | 'R1' | 'R2' | 'R3' | 'F1' | 'F2' | 'F3' | 'F4';
export type ReviewSignal = 'muted' | 'accent' | 'caution' | 'fail';

export const REVIEW_STAGE_MARK: Readonly<Record<ReviewStageStatus, string>> = {
  done: '✓',
  running: '▸',
  todo: '○',
  skipped: '–',
  gap: '◐',
};

export interface ReviewViewStage {
  id: string;
  index: number;
  name: string;
  label: string;
  running: string;
  state: ReviewStageStatus;
  mark: string;
  sub_progress: null;
  gaps: string[];
  started_at: string | null;
  ended_at: string | null;
}

export interface ReviewViewGap {
  code: string;
  stage: string;
  say: string;
  footnote: string;
  next_action: string;
}

export interface ReviewHeadline {
  row: ReviewHeadlineRow;
  text: string;
  signal: ReviewSignal;
}

export interface ReviewView {
  schema_version: 1;
  generated_at: string;
  updated_at: string;
  kind: ReviewKind['id'];
  route: string;
  word: string;
  workflow: string;
  run_id: string;
  status: ReviewViewStatus;
  stalled: boolean;
  headline: ReviewHeadline;
  status_line: string | null;
  stages: ReviewViewStage[];
  current: string | null;
  current_stage: string | null;
  alt: string;
  findings: Record<Severity, number> & { confirmed: number; serious: number };
  leads: number;
  leads_note: string | null;
  gaps: ReviewViewGap[];
  button: 'Resume' | null;
  celebrate: false;
  uncommitted_note: null;
  refusal: string | null;
  resume_prompt: string;
  continue_words: string;
  finished_at: string | null;
}

export interface BuildReviewViewOptions {
  now?: () => Date;
  refusal?: string | null;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function stageState(run: ReviewRun, stage: ReviewStageDefinition): ReviewStageStatus {
  const status = run.stages[stage.id]?.status ?? 'todo';
  if (status === 'running' || status === 'skipped') return status;
  return run.gaps.some((gap) => gap.stage === stage.id) ? 'gap' : status;
}

function nextStage(run: ReviewRun, kind: ReviewKind): ReviewStageDefinition | null {
  return (
    kind.stages.find((stage) => {
      const status = run.stages[stage.id]?.status ?? 'todo';
      return status === 'todo' || status === 'gap';
    }) ?? null
  );
}

function stalledRun(run: ReviewRun, now: Date): boolean {
  if (run.status !== 'running' || run.current_stage === null) return false;
  if (run.stages[run.current_stage]?.status !== 'running') return false;
  return now.getTime() - Date.parse(run.updated_at) > STALL_MS;
}

function viewStatus(run: ReviewRun, stalled: boolean): ReviewViewStatus {
  if (run.status === 'finished') return 'finished';
  if (run.status === 'abandoned') return 'abandoned';
  if (run.status === 'stopped' || stalled) return 'stopped';
  const anyStarted = Object.values(run.stages).some((stage) => stage.status !== 'todo');
  if (!anyStarted && run.gaps.length === 0) return 'not_started';
  const current = run.current_stage === null ? null : run.stages[run.current_stage];
  return current?.status === 'running' ? 'running' : 'between';
}

function focusStage(
  run: ReviewRun,
  kind: ReviewKind,
  status: ReviewViewStatus,
): ReviewStageDefinition | null {
  const byId = (id: string | null) =>
    id === null ? null : (kind.stages.find((stage) => stage.id === id) ?? null);
  if (status === 'stopped' || status === 'abandoned') {
    return byId(run.stopped?.stage ?? null) ?? byId(run.current_stage) ?? nextStage(run, kind);
  }
  if (status === 'running') return byId(run.current_stage);
  if (status === 'between') return nextStage(run, kind) ?? byId(run.current_stage);
  if (status === 'finished') return byId(run.current_stage);
  return null;
}

function counts(run: ReviewRun): ReviewView['findings'] & { leads: number } {
  const findings = { critical: 0, high: 0, medium: 0, low: 0, info: 0 } as Record<Severity, number>;
  let leads = 0;
  for (const finding of run.findings) {
    if (finding.proof === 'lead') leads += 1;
    else findings[finding.severity] += 1;
  }
  const confirmed = SEVERITIES.reduce((sum, severity) => sum + findings[severity], 0);
  const serious = SEVERITIES.filter((severity) => SERIOUS.has(severity)).reduce(
    (sum, severity) => sum + findings[severity],
    0,
  );
  return { ...findings, confirmed, serious, leads };
}

function finishedHeadline(findings: ReviewView['findings'], gaps: number): ReviewHeadline {
  if (findings.serious > 0) {
    return {
      row: 'F1',
      text: `${plural(findings.serious, 'serious finding', 'serious findings')} confirmed`,
      signal: 'fail',
    };
  }
  if (findings.confirmed > 0) {
    return {
      row: 'F2',
      text: `${plural(findings.confirmed, 'finding', 'findings')} confirmed`,
      signal: 'caution',
    };
  }
  if (gaps > 0)
    return { row: 'F3', text: `Done with ${plural(gaps, 'gap', 'gaps')}`, signal: 'caution' };
  return { row: 'F4', text: 'No finding confirmed', signal: 'muted' };
}

function headline(
  kind: ReviewKind,
  status: ReviewViewStatus,
  focus: ReviewStageDefinition | null,
  findings: ReviewView['findings'],
  gaps: number,
): ReviewHeadline {
  const total = kind.stages.length;
  switch (status) {
    case 'not_started':
      return { row: 'R0', text: `${kind.word} has not started`, signal: 'muted' };
    case 'running':
      return {
        row: 'R1',
        text: `Stage ${focus?.index ?? '?'} of ${total} · ${focus?.running ?? ''}`,
        signal: 'accent',
      };
    case 'between':
      return {
        row: 'R2',
        text: `Next: stage ${focus?.index ?? '?'} of ${total} · ${focus?.name ?? ''}`,
        signal: 'muted',
      };
    case 'stopped':
    case 'abandoned':
      return {
        row: 'R3',
        text: `Stopped at stage ${focus?.index ?? '?'} · ${focus?.name ?? ''} · Resume to continue`,
        signal: 'caution',
      };
    case 'finished':
      return finishedHeadline(findings, gaps);
  }
}

const STATE_WORDS: Readonly<Record<ReviewStageStatus, string>> = {
  done: 'done',
  running: 'running',
  todo: 'not started',
  skipped: 'skipped',
  gap: 'with a gap',
};

function altText(stages: ReviewViewStage[], findings: ReviewView['findings'], leads: number) {
  const parts: string[] = [];
  let notStarted = 0;
  for (const stage of stages) {
    if (stage.state === 'todo') notStarted += 1;
    else parts.push(`${stage.label} ${STATE_WORDS[stage.state]}`);
  }
  if (notStarted > 0) parts.push(`${notStarted} not started`);
  for (const severity of SEVERITIES) {
    const count = findings[severity];
    if (count > 0) {
      parts.push(`${plural(count, `${severity} finding`, `${severity} findings`)} confirmed`);
    }
  }
  if (leads > 0) parts.push(plural(leads, 'lead', 'leads'));
  return parts.join(', ');
}

export function buildReviewView(
  kind: ReviewKind,
  run: ReviewRun,
  options: BuildReviewViewOptions = {},
): ReviewView {
  const now = (options.now ?? (() => new Date()))();
  const stalled = stalledRun(run, now);
  const status = viewStatus(run, stalled);
  const stages: ReviewViewStage[] = kind.stages.map((stage) => {
    const state = stageState(run, stage);
    const record = run.stages[stage.id];
    return {
      id: stage.id,
      index: stage.index,
      name: stage.name,
      label: stage.label,
      running: stage.running,
      state,
      mark: REVIEW_STAGE_MARK[state],
      sub_progress: null,
      gaps: run.gaps.filter((gap) => gap.stage === stage.id).map((gap) => gap.code),
      started_at: record?.started_at ?? null,
      ended_at: record?.ended_at ?? null,
    };
  });
  const { leads, ...findings } = counts(run);
  const focus = focusStage(run, kind, status);
  const gaps: ReviewViewGap[] = run.gaps.map((gap) => {
    const label = kind.stages.find((stage) => stage.id === gap.stage)?.label ?? gap.stage;
    return {
      code: gap.code,
      stage: gap.stage,
      say: gap.say,
      footnote: `${label}: ${gap.say}`,
      next_action: '',
    };
  });
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    updated_at: run.updated_at,
    kind: kind.id,
    route: kind.route,
    word: kind.word,
    workflow: kind.word,
    run_id: run.run_id,
    status,
    stalled,
    headline: headline(kind, status, focus, findings, gaps.length),
    status_line: status === 'running' && focus ? focus.running : null,
    stages,
    current: focus?.id ?? null,
    current_stage: run.current_stage,
    alt: altText(stages, findings, leads),
    findings,
    leads,
    leads_note: leads > 0 ? `${plural(leads, 'lead', 'leads')}, not confirmed` : null,
    gaps,
    button: status === 'stopped' || status === 'abandoned' ? 'Resume' : null,
    celebrate: false,
    uncommitted_note: null,
    refusal: options.refusal ?? null,
    resume_prompt: kind.resume_prompt,
    continue_words: kind.continue_words,
    finished_at: run.finished_at,
  };
}

export function reviewShown(
  view: Pick<ReviewView, 'status' | 'finished_at'> | null,
  nowMs: number,
): boolean {
  if (view === null) return false;
  if (view.status !== 'finished' && view.status !== 'abandoned') return true;
  const at = view.finished_at ? Date.parse(view.finished_at) : Number.NaN;
  return Number.isFinite(at) && nowMs - at < FINISH_SCREEN_MS;
}

export function isOpenRun(run: ReviewRun): boolean {
  return OPEN_STATUSES.has(run.status);
}
