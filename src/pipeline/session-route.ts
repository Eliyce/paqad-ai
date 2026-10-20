import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { ROUTED_WORKFLOWS, type RoutedWorkflow } from './routed-workflow.js';

const SESSION_ROUTE_FILE = '.session-route.json';
const SESSION_ROUTE_DIR = '.session-route.d';

export interface SessionRoute {
  workflow: RoutedWorkflow;
  query: string;
  adapter?: string;
}

function sessionRouteDir(projectRoot: string): string {
  return join(projectRoot, dirname(PATHS.CONTEXT_SESSION_ARTIFACT));
}

const VALID_WORKFLOWS = new Set<string>(ROUTED_WORKFLOWS);

function perSessionRoutePath(projectRoot: string, sessionId?: string | null): string | null {
  const safe =
    typeof sessionId === 'string' ? sessionId.trim().replace(/[^A-Za-z0-9_-]/g, '_') : '';
  return safe.length === 0
    ? null
    : join(sessionRouteDir(projectRoot), SESSION_ROUTE_DIR, `${safe}.json`);
}

export function writeSessionRoute(
  projectRoot: string,
  route: SessionRoute,
  sessionId?: string | null,
): void {
  try {
    const dir = sessionRouteDir(projectRoot);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, SESSION_ROUTE_FILE), JSON.stringify(route), 'utf8');
    const own = perSessionRoutePath(projectRoot, sessionId);
    if (own) {
      mkdirSync(dirname(own), { recursive: true });
      writeFileSync(own, JSON.stringify(route), 'utf8');
    }
  } catch {}
}

export interface ContextComposition {
  loadRules: boolean;
  retrieves: boolean;
}

export function compositionForRoute(route: SessionRoute | null): ContextComposition {
  if (!route) {
    return { loadRules: true, retrieves: true };
  }
  return {
    loadRules: route.workflow === 'feature-development',
    retrieves: route.workflow !== 'no-workflow',
  };
}

export function readSessionRoute(
  projectRoot: string,
  sessionId?: string | null,
): SessionRoute | null {
  const own = perSessionRoutePath(projectRoot, sessionId);
  return (
    (own ? parseRouteFile(own) : null) ??
    parseRouteFile(join(sessionRouteDir(projectRoot), SESSION_ROUTE_FILE))
  );
}

function parseRouteFile(path: string): SessionRoute | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      workflow?: unknown;
      query?: unknown;
      adapter?: unknown;
    };
    if (typeof parsed.workflow !== 'string' || !VALID_WORKFLOWS.has(parsed.workflow)) {
      return null;
    }
    return {
      workflow: parsed.workflow as RoutedWorkflow,
      query: typeof parsed.query === 'string' ? parsed.query : '',
      ...(typeof parsed.adapter === 'string' ? { adapter: parsed.adapter } : {}),
    };
  } catch {
    return null;
  }
}
