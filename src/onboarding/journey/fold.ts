import { ONBOARDING_STAGES } from './stages.js';
import type { JourneyEvent, JourneyRun, StageId, StageStatus } from './types.js';

export const INTERRUPTED_AFTER_MS = 20 * 60 * 1000;

export interface StageFold {
  id: StageId;
  status: StageStatus;
  units_done: string[];
  units_todo: string[];
  done: number;
  total: number | null;
  last_unit: string | null;
}

export interface JourneyFold {
  stages: Record<StageId, StageFold>;
  current: StageId | null;
  interrupted: boolean;
  last_heartbeat: string;
  open_agents: string[];
}

export interface FoldOptions {
  now?: () => Date;
  currentSourceHashes?: Record<string, string>;
}

export function unitRowsForStage(
  run: JourneyRun,
  events: readonly JourneyEvent[],
  stage: StageId,
): JourneyEvent[] {
  const startedAt = run.stages[stage].started_at;
  if (!startedAt) return [];
  return events.filter(
    (event) =>
      event.run_id === run.run_id &&
      event.stage === stage &&
      (event.kind === 'unit' || event.kind === 'unit_kept') &&
      typeof event.unit === 'string' &&
      event.ts >= startedAt,
  );
}

function countsAsDone(event: JourneyEvent, hashes: Record<string, string> | undefined): boolean {
  if (!hashes || event.source_hash === undefined || event.unit === undefined) return true;
  const current = hashes[event.unit];
  return current === undefined || current === event.source_hash;
}

function latestProgress(
  run: JourneyRun,
  events: readonly JourneyEvent[],
  stage: StageId,
): JourneyEvent | null {
  const startedAt = run.stages[stage].started_at;
  if (!startedAt) return null;
  let latest: JourneyEvent | null = null;
  for (const event of events) {
    if (event.run_id !== run.run_id || event.stage !== stage || event.kind !== 'progress') continue;
    if (event.ts < startedAt) continue;
    if (!latest || event.ts >= latest.ts) latest = event;
  }
  return latest;
}

export function foldStage(
  run: JourneyRun,
  events: readonly JourneyEvent[],
  stage: StageId,
  options: FoldOptions = {},
): StageFold {
  const record = run.stages[stage];
  const hashes = stage === 'module_docs' ? options.currentSourceHashes : undefined;
  const done: string[] = [];
  let lastUnit: string | null = null;
  for (const event of unitRowsForStage(run, events, stage)) {
    if (!countsAsDone(event, hashes)) continue;
    const unit = event.unit as string;
    lastUnit = unit;
    if (!done.includes(unit)) done.push(unit);
  }
  const plan = record.plan ?? [];
  const todo = plan.filter((unit) => !done.includes(unit));
  const progress = latestProgress(run, events, stage);
  let total: number | null = plan.length > 0 ? plan.length : (record.planned ?? null);
  let doneCount = plan.length > 0 ? plan.length - todo.length : done.length;
  if (progress && typeof progress.done === 'number' && typeof progress.total === 'number') {
    doneCount = Math.max(doneCount, progress.done);
    total = progress.total;
  }
  return {
    id: stage,
    status: record.status,
    units_done: done,
    units_todo: todo,
    done: doneCount,
    total,
    last_unit: lastUnit,
  };
}

function openAgents(run: JourneyRun, events: readonly JourneyEvent[]): string[] {
  const open = new Map<string, number>();
  for (const event of events) {
    if (event.run_id !== run.run_id || !event.agent) continue;
    if (event.kind === 'agent_start') open.set(event.agent, (open.get(event.agent) ?? 0) + 1);
    if (event.kind === 'agent_stop')
      open.set(event.agent, Math.max(0, (open.get(event.agent) ?? 0) - 1));
  }
  return [...open.entries()].filter(([, count]) => count > 0).map(([agent]) => agent);
}

function lastHeartbeat(run: JourneyRun, events: readonly JourneyEvent[]): string {
  let latest = run.updated_at;
  for (const event of events) {
    if (event.run_id === run.run_id && event.ts > latest) latest = event.ts;
  }
  return latest;
}

export function currentStage(run: JourneyRun): StageId | null {
  for (const stage of ONBOARDING_STAGES) {
    const status = run.stages[stage.id].status;
    if (status === 'running' || status === 'failed') return stage.id;
  }
  for (const stage of ONBOARDING_STAGES) {
    if (run.stages[stage.id].status === 'not_started') return stage.id;
  }
  return null;
}

export function foldJourney(
  run: JourneyRun,
  events: readonly JourneyEvent[],
  options: FoldOptions = {},
): JourneyFold {
  const now = options.now ?? (() => new Date());
  const stages = Object.fromEntries(
    ONBOARDING_STAGES.map((stage) => [stage.id, foldStage(run, events, stage.id, options)]),
  ) as Record<StageId, StageFold>;
  const current = currentStage(run);
  const heartbeat = lastHeartbeat(run, events);
  const agents = openAgents(run, events);
  const running = current !== null && run.stages[current].status === 'running';
  const silentFor = now().getTime() - new Date(heartbeat).getTime();
  const interrupted =
    run.status === 'running' && running && agents.length === 0 && silentFor > INTERRUPTED_AFTER_MS;
  return { stages, current, interrupted, last_heartbeat: heartbeat, open_agents: agents };
}
