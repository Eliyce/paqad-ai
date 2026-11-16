import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { writeFileAtomic } from '@/hud/files.js';

import { DEGRADED } from './degraded.js';
import { readEvents } from './events.js';
import { foldJourney, type JourneyFold, type StageFold } from './fold.js';
import { readRun } from './run-store.js';
import { ONBOARDING_STAGES, STAGE_COUNT, statusLine } from './stages.js';
import type { DegradedCode, JourneyEvent, JourneyRun, StageDefinition, StageId } from './types.js';

export const WORKFLOW_WORD = 'Onboarding';
export const ETA_MIN_UNITS = 3;

export type ViewStatus =
  | 'not_started'
  | 'running'
  | 'between'
  | 'paused'
  | 'stopped'
  | 'asking_commit'
  | 'done'
  | 'done_with_gaps';

export type ViewStageState = 'todo' | 'running' | 'done' | 'degraded' | 'failed';
export type HeadlineRow = 'O1' | 'O2' | 'O3' | 'O4' | 'O5' | 'O6';

export const STAGE_MARK: Record<ViewStageState, string> = {
  done: '✓',
  running: '▸',
  todo: '○',
  failed: '✗',
  degraded: '◐',
};

export interface ViewSubProgress {
  done: number;
  total: number | null;
  current: string | null;
  words: string;
  eta_minutes: number | null;
}

export interface ViewStage {
  id: StageId;
  index: number;
  name: string;
  label: string;
  running: string;
  state: ViewStageState;
  mark: string;
  sub_progress: ViewSubProgress | null;
  gaps: DegradedCode[];
  started_at: string | null;
  ended_at: string | null;
}

export interface ViewGap {
  code: DegradedCode;
  stage: StageId;
  footnote: string;
  next_action: string;
}

export interface JourneyView {
  schema_version: 1;
  generated_at: string;
  workflow: typeof WORKFLOW_WORD;
  run_id: string | null;
  status: ViewStatus;
  headline: { row: HeadlineRow; text: string };
  status_line: string | null;
  stages: ViewStage[];
  current: StageId | null;
  alt: string;
  planned: { modules: number | null; packages: number | null; rules: number | null };
  estimate: string;
  gaps: ViewGap[];
  button: 'Resume' | 'Commit' | null;
  celebrate: boolean;
  uncommitted_note: string | null;
  left_out: Array<{ path: string; reason: string }>;
  refusal: string | null;
}

export interface BuildViewOptions {
  now?: () => Date;
  refusal?: string | null;
}

function stageState(run: JourneyRun, id: StageId): ViewStageState {
  const status = run.stages[id].status;
  return status === 'not_started' ? 'todo' : status;
}

function unitTimes(run: JourneyRun, events: readonly JourneyEvent[], id: StageId): number[] {
  const startedAt = run.stages[id].started_at;
  if (!startedAt) return [];
  return events
    .filter(
      (event) =>
        event.run_id === run.run_id &&
        event.stage === id &&
        event.kind === 'unit' &&
        event.ts >= startedAt,
    )
    .map((event) => new Date(event.ts).getTime());
}

function etaMinutes(
  run: JourneyRun,
  events: readonly JourneyEvent[],
  fold: StageFold,
  now: Date,
): number | null {
  if (fold.total === null || fold.done < ETA_MIN_UNITS || fold.done >= fold.total) return null;
  const startedAt = run.stages[fold.id].started_at;
  if (!startedAt) return null;
  const times = unitTimes(run, events, fold.id);
  const last = times.length > 0 ? Math.max(...times) : now.getTime();
  const perUnit = (last - new Date(startedAt).getTime()) / fold.done;
  return Math.max(1, Math.round((perUnit * (fold.total - fold.done)) / 60_000));
}

function subProgress(
  run: JourneyRun,
  events: readonly JourneyEvent[],
  stage: StageDefinition,
  fold: StageFold,
  now: Date,
): ViewSubProgress | null {
  if (!stage.unit || run.stages[stage.id].status !== 'running') return null;
  const current = fold.units_todo[0] ?? null;
  if (fold.total === null) {
    return { done: fold.done, total: null, current, words: current ?? '', eta_minutes: null };
  }
  const parts = [`${fold.done} of ${fold.total}`];
  if (current) parts.push(current);
  return {
    done: fold.done,
    total: fold.total,
    current,
    words: parts.join(' · '),
    eta_minutes: etaMinutes(run, events, fold, now),
  };
}

function viewStatus(run: JourneyRun | null, fold: JourneyFold | null, gaps: ViewGap[]): ViewStatus {
  if (!run || !fold) return 'not_started';
  if (run.status === 'abandoned' || run.status === 'paused') return 'paused';
  if (run.status === 'failed' || fold.interrupted) return 'stopped';
  if (fold.current !== null && run.stages[fold.current].status === 'failed') return 'stopped';
  if (run.stages.finish.status === 'done' || run.stages.finish.status === 'degraded') {
    if (!run.commit) return 'asking_commit';
    return gaps.length > 0 ? 'done_with_gaps' : 'done';
  }
  if (fold.current !== null && run.stages[fold.current].status === 'running') return 'running';
  return 'between';
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function headline(
  status: ViewStatus,
  run: JourneyRun | null,
  current: ViewStage | null,
  gaps: ViewGap[],
): { row: HeadlineRow; text: string } {
  switch (status) {
    case 'not_started':
      return { row: 'O6', text: 'Onboarding has not started' };
    case 'stopped':
      return {
        row: 'O1',
        text: `Stopped at step ${current?.index ?? '?'} · ${current?.name ?? ''} · Resume to continue`,
      };
    case 'paused':
      return {
        row: 'O1',
        text: `Paused at step ${current?.index ?? '?'} · ${current?.name ?? ''} · Resume to continue`,
      };
    case 'running': {
      const detail = current?.sub_progress?.words;
      return {
        row: 'O2',
        text: [`Step ${current?.index} of ${STAGE_COUNT}`, current?.running, detail]
          .filter(Boolean)
          .join(' · '),
      };
    }
    case 'asking_commit':
      return { row: 'O3', text: 'Commit these changes on a new branch? Waiting for your answer' };
    case 'between':
      return {
        row: 'O4',
        text: `Next: step ${current?.index ?? '?'} of ${STAGE_COUNT} · ${current?.name ?? ''}`,
      };
    case 'done':
      return {
        row: 'O5',
        text: run?.commit?.answer === 'branch' ? 'Onboarding done · committed' : 'Onboarding done',
      };
    case 'done_with_gaps':
      return { row: 'O5', text: `Onboarding done with ${plural(gaps.length, 'gap')}` };
  }
}

function altText(stages: ViewStage[]): string {
  const parts: string[] = [];
  let notStarted = 0;
  for (const stage of stages) {
    if (stage.state === 'todo') {
      notStarted += 1;
      continue;
    }
    const words = {
      done: 'done',
      running: 'running',
      failed: 'stopped',
      degraded: 'done with a gap',
      todo: 'not started',
    }[stage.state];
    const total = stage.sub_progress?.total;
    const counts =
      stage.sub_progress && total !== null && total !== undefined
        ? ` ${stage.sub_progress.done} of ${total}`
        : '';
    parts.push(`${stage.label} ${words}${counts}`);
  }
  if (notStarted > 0) parts.push(`${notStarted} not started`);
  return parts.join(', ');
}

function plannedCount(run: JourneyRun | null, id: StageId): number | null {
  if (!run) return null;
  const record = run.stages[id];
  if (record.plan && record.plan.length > 0) return record.plan.length;
  return record.planned ?? null;
}

export function estimateWords(planned: JourneyView['planned']): string {
  const low =
    10 + (planned.modules ?? 10) * 2 + (planned.packages ?? 20) + (planned.rules ?? 40) * 0.5;
  const high =
    30 + (planned.modules ?? 10) * 4 + (planned.packages ?? 20) * 1.5 + (planned.rules ?? 40);
  const lowHours = Math.max(1, Math.round(low / 60));
  const highHours = Math.min(5, Math.max(lowHours + 1, Math.round(high / 60)));
  return `about ${lowHours} to ${highHours} hours`;
}

export function buildView(
  run: JourneyRun | null,
  events: readonly JourneyEvent[],
  options: BuildViewOptions = {},
): JourneyView {
  const now = (options.now ?? (() => new Date()))();
  const fold = run ? foldJourney(run, events, { now: () => now }) : null;
  const stages: ViewStage[] = ONBOARDING_STAGES.map((stage) => {
    const state = run ? stageState(run, stage.id) : 'todo';
    return {
      id: stage.id,
      index: stage.index,
      name: stage.name,
      label: stage.label,
      running: stage.running,
      state,
      mark: STAGE_MARK[state],
      sub_progress:
        run && fold ? subProgress(run, events, stage, fold.stages[stage.id], now) : null,
      gaps: run ? [...(run.stages[stage.id].degraded ?? [])] : [],
      started_at: run?.stages[stage.id].started_at ?? null,
      ended_at: run?.stages[stage.id].ended_at ?? null,
    };
  });
  const gaps: ViewGap[] = stages.flatMap((stage) =>
    stage.gaps.map((code) => ({
      code,
      stage: stage.id,
      footnote: DEGRADED[code].footnote,
      next_action: DEGRADED[code].next_action,
    })),
  );
  const status = viewStatus(run, fold, gaps);
  const currentId = fold?.current ?? null;
  const current = stages.find((stage) => stage.id === currentId) ?? null;
  const planned = {
    modules: plannedCount(run, 'module_docs'),
    packages: plannedCount(run, 'rules_discovery'),
    rules: plannedCount(run, 'rules_analyze'),
  };
  const uncommitted =
    run?.commit && run.commit.answer !== 'branch'
      ? 'Your changes are uncommitted. Commit them later with `paqad-ai onboarding commit --branch <name>`.'
      : null;
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    workflow: WORKFLOW_WORD,
    run_id: run?.run_id ?? null,
    status,
    headline: headline(status, run, current, gaps),
    status_line:
      current && status === 'running'
        ? statusLine(current.id, current.sub_progress?.words || undefined)
        : null,
    stages,
    current: currentId,
    alt: altText(stages),
    planned,
    estimate: estimateWords(planned),
    gaps,
    button:
      status === 'stopped' || status === 'paused'
        ? 'Resume'
        : status === 'asking_commit'
          ? 'Commit'
          : null,
    celebrate: status === 'done' && gaps.length === 0,
    uncommitted_note: uncommitted,
    left_out: [...(run?.commit?.left_out ?? [])],
    refusal: options.refusal ?? null,
  };
}

export function viewPath(projectRoot: string): string {
  return join(projectRoot, PATHS.ONBOARDING_VIEW);
}

export function writeView(projectRoot: string, options: BuildViewOptions = {}): JourneyView {
  const run = readRun(projectRoot);
  const view = buildView(run, run ? readEvents(projectRoot, run.run_id) : [], options);
  if (run) writeFileAtomic(viewPath(projectRoot), `${JSON.stringify(view, null, 2)}\n`);
  return view;
}
