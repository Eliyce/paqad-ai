import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { appendDashboardAudit } from './approvals.js';

/**
 * Issue #161 — project-scoped saved views. A saved view captures a scope a
 * person returns to: a graph filter, a Trust verdict filter, or a SIEM export
 * config. Stored in `.paqad/dashboard/saved-views.json` so a team shares them
 * through git. Writes flow through the dashboard mutation guard in
 * `server.ts`; this module owns parsing, validation, and the atomic write.
 */

const SAVED_VIEWS_RELATIVE = '.paqad/dashboard/saved-views.json';

export type SavedViewArea = 'graph' | 'trust' | 'export';

const SAVED_VIEW_AREAS: readonly SavedViewArea[] = ['graph', 'trust', 'export'];

export interface SavedView {
  id: string;
  name: string;
  area: SavedViewArea;
  /** Area-specific scope, opaque to the store (graph filter, verdict, export config). */
  scope: Record<string, unknown>;
  createdAt: string;
}

/** Thrown when a delete targets an id that is not present (→ HTTP 404). */
export class SavedViewNotFoundError extends Error {
  constructor(id: string) {
    super(`No saved view with id ${id}.`);
    this.name = 'SavedViewNotFoundError';
  }
}

function savedViewsPath(projectRoot: string): string {
  return join(projectRoot, SAVED_VIEWS_RELATIVE);
}

function isSavedView(value: unknown): value is SavedView {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.area === 'string' &&
    (SAVED_VIEW_AREAS as readonly string[]).includes(v.area) &&
    typeof v.scope === 'object' &&
    v.scope !== null &&
    typeof v.createdAt === 'string'
  );
}

/** Read the saved views, tolerating a missing or malformed file (returns []). */
export function listSavedViews(projectRoot: string): SavedView[] {
  const path = savedViewsPath(projectRoot);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedView);
  } catch {
    return [];
  }
}

function writeSavedViews(projectRoot: string, views: SavedView[]): void {
  const path = savedViewsPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.saved-views-${process.pid}.tmp`);
  writeFileSync(temp, `${JSON.stringify(views, null, 2)}\n`);
  renameSync(temp, path);
}

export interface PutSavedViewInput {
  id: string;
  name: unknown;
  area: unknown;
  scope: unknown;
}

/**
 * Create or replace a saved view by id. The id comes from the route and must
 * be a safe slug (it is also a JSON key and a URL segment). Creating stamps
 * `createdAt`; replacing preserves the original.
 */
export function putSavedView(projectRoot: string, input: PutSavedViewInput): SavedView {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.id)) {
    throw new Error('Saved view id must be 1-64 chars of letters, digits, dash, or underscore.');
  }
  if (typeof input.name !== 'string' || input.name.trim().length === 0) {
    throw new Error('Body must include a non-empty `name` string.');
  }
  if (
    typeof input.area !== 'string' ||
    !(SAVED_VIEW_AREAS as readonly string[]).includes(input.area)
  ) {
    throw new Error(`Body must include an \`area\` of ${SAVED_VIEW_AREAS.join(' | ')}.`);
  }
  if (typeof input.scope !== 'object' || input.scope === null || Array.isArray(input.scope)) {
    throw new Error('Body must include a `scope` object.');
  }

  const views = listSavedViews(projectRoot);
  const existing = views.find((view) => view.id === input.id);
  const view: SavedView = {
    id: input.id,
    name: input.name.trim().slice(0, 80),
    area: input.area as SavedViewArea,
    scope: input.scope as Record<string, unknown>,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  const next = existing ? views.map((v) => (v.id === input.id ? view : v)) : [...views, view];
  writeSavedViews(projectRoot, next);
  appendDashboardAudit(projectRoot, 'dashboard.saved-views.write', {
    id: view.id,
    area: view.area,
  });
  return view;
}

export interface DeleteSavedViewResult {
  id: string;
  removed: true;
}

/** Remove a saved view by id, 404 when it is not present. */
export function deleteSavedView(projectRoot: string, id: string): DeleteSavedViewResult {
  const views = listSavedViews(projectRoot);
  if (!views.some((view) => view.id === id)) {
    throw new SavedViewNotFoundError(id);
  }
  writeSavedViews(
    projectRoot,
    views.filter((view) => view.id !== id),
  );
  appendDashboardAudit(projectRoot, 'dashboard.saved-views.delete', { id });
  return { id, removed: true };
}
