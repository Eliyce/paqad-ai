// .paqad/module-map/events.jsonl writer/reader. Append-only audit trail of
// every accepted module decision, reconciliation outcome, and rollup.
// Issue #80, Phase 1 §4.6. Reused by Phases 2-4.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

export type ModuleMapEventType =
  | 'module.declared'
  | 'module.reconciled'
  | 'module.health.rolled-up'
  | 'module.decision.expired'
  | 'module.decision.rejected'
  | 'module.map.snapshot'
  // PQD-104 — emitted once for a workflow/pipeline/index run that a consumer
  // cancelled via an AbortSignal. No further events for that run_id follow.
  | 'run.cancelled';

export interface ModuleMapEvent {
  ts: string;
  type: ModuleMapEventType;
  slug?: string;
  via?: string;
  approved_by?: string;
  /** Correlates the event to a specific workflow or pipeline run (PQD-104). */
  run_id?: string;
  payload?: Record<string, unknown>;
}

function eventsPath(projectRoot: string): string {
  return join(projectRoot, PATHS.MODULE_MAP_EVENTS_LOG);
}

function ensureEventsFile(projectRoot: string): string {
  const path = eventsPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

export function appendModuleMapEvent(projectRoot: string, event: ModuleMapEvent): void {
  const path = ensureEventsFile(projectRoot);
  appendFileSync(path, JSON.stringify(event) + '\n', 'utf8');
}

/**
 * Append the single `run.cancelled` audit event for a consumer-cancelled run
 * (PQD-104). Call sites guard so this fires at most once per run; a second
 * abort on an already-cancelled run must not write a duplicate event.
 */
export function appendRunCancelledEvent(
  projectRoot: string,
  runId: string,
  payload?: Record<string, unknown>,
): void {
  appendModuleMapEvent(projectRoot, {
    ts: new Date().toISOString(),
    type: 'run.cancelled',
    run_id: runId,
    payload,
  });
}

export function readModuleMapEvents(projectRoot: string): ModuleMapEvent[] {
  const path = eventsPath(projectRoot);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  const out: ModuleMapEvent[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed) as ModuleMapEvent;
      if (typeof parsed === 'object' && parsed !== null && typeof parsed.type === 'string') {
        out.push(parsed);
      }
    } catch {
      // Skip malformed lines; events.jsonl is append-only but partial writes
      // (e.g. mid-crash) shouldn't poison the whole reader.
    }
  }
  return out;
}

export function readModuleMapEventsSince(projectRoot: string, sinceIso: string): ModuleMapEvent[] {
  const since = Date.parse(sinceIso);
  if (!Number.isFinite(since)) return readModuleMapEvents(projectRoot);
  return readModuleMapEvents(projectRoot).filter((e) => {
    const ts = Date.parse(e.ts);
    return Number.isFinite(ts) && ts >= since;
  });
}

export function readModuleMapEventsForSlug(projectRoot: string, slug: string): ModuleMapEvent[] {
  return readModuleMapEvents(projectRoot).filter((e) => e.slug === slug);
}
