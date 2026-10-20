import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { EngineErrorCode } from '@/core/errors/taxonomy.js';

export type ModuleMapEventType =
  | 'module.declared'
  | 'module.reconciled'
  | 'module.health.rolled-up'
  | 'module.decision.expired'
  | 'module.decision.rejected'
  | 'module.map.snapshot'
  | 'run.cancelled'
  | 'context.truncated';

export interface ModuleMapEvent {
  ts: string;
  type: ModuleMapEventType;
  slug?: string;
  via?: string;
  approved_by?: string;
  run_id?: string;
  error_code?: EngineErrorCode;
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

export function appendRunCancelledEvent(
  projectRoot: string,
  runId: string,
  payload?: Record<string, unknown>,
): void {
  appendModuleMapEvent(projectRoot, {
    ts: new Date().toISOString(),
    type: 'run.cancelled',
    run_id: runId,
    error_code: 'CANCELLED_BY_CONSUMER',
    payload,
  });
}

export function emitContextTruncated(
  projectRoot: string,
  payload: { sessionId: string; turnsDropped: number; tokensReclaimed: number },
): void {
  appendModuleMapEvent(projectRoot, {
    ts: new Date().toISOString(),
    type: 'context.truncated',
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
    } catch {}
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
