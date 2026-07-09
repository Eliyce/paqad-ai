// Latest-route pointer for the background context worker (issue #336).
//
// The route seam runs in-process on the prompt path and knows the routed workflow
// and the prompt text. The context worker (`paqad-ai rag refresh-context`) runs
// DETACHED afterwards and composes the single, session-agnostic session-context
// artifact — so it needs to know which workflow the last prompt routed to (to load
// rules only for feature-development and to skip retrieval for no-workflow) and the
// prompt text (to seed retrieval, not just the working set). Threading those through
// the detached trigger→worker chain is brittle, so the seam drops them here at a
// fixed path next to the artifact and the worker reads them back.
//
// One value, last-writer-wins — the same shape as the shared artifact it feeds. The
// read never throws: an absent or unreadable pointer means "no route recorded yet".

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { ROUTED_WORKFLOWS, type RoutedWorkflow } from './routed-workflow.js';

const SESSION_ROUTE_FILE = '.session-route.json';

/** The routed workflow of the last prompt, plus the prompt text (retrieval seed). */
export interface SessionRoute {
  workflow: RoutedWorkflow;
  query: string;
}

/** Directory of the session-context artifact — the pointer sits beside it. */
function sessionRouteDir(projectRoot: string): string {
  return join(projectRoot, dirname(PATHS.CONTEXT_SESSION_ARTIFACT));
}

const VALID_WORKFLOWS = new Set<string>(ROUTED_WORKFLOWS);

/** Record the last route for the background worker. Never throws into the caller. */
export function writeSessionRoute(projectRoot: string, route: SessionRoute): void {
  try {
    const dir = sessionRouteDir(projectRoot);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, SESSION_ROUTE_FILE), JSON.stringify(route), 'utf8');
  } catch {
    // Best-effort — the worker falls back to loading rules + retrieving (today's
    // behaviour) when no pointer is present, so a failed write never loses coverage.
  }
}

/** What the background context worker should compose for a routed workflow (#336). */
export interface ContextComposition {
  /** Compose the rule slice? Only on the feature-development route. */
  loadRules: boolean;
  /** Retrieve slices + codebase memory + base-drift? Every real workflow; not no-workflow. */
  retrieves: boolean;
}

/**
 * Decide what the artifact carries for a route. No pointer yet (the first prompt of
 * a session, before routing has run) falls back to today's behaviour — load rules and
 * retrieve — so nothing regresses before the seam records a route.
 */
export function compositionForRoute(route: SessionRoute | null): ContextComposition {
  if (!route) {
    return { loadRules: true, retrieves: true };
  }
  return {
    loadRules: route.workflow === 'feature-development',
    retrieves: route.workflow !== 'no-workflow',
  };
}

/** Read the last route, or null when absent/unreadable/invalid. */
export function readSessionRoute(projectRoot: string): SessionRoute | null {
  try {
    const parsed = JSON.parse(
      readFileSync(join(sessionRouteDir(projectRoot), SESSION_ROUTE_FILE), 'utf8'),
    ) as { workflow?: unknown; query?: unknown };
    if (typeof parsed.workflow !== 'string' || !VALID_WORKFLOWS.has(parsed.workflow)) {
      return null;
    }
    return {
      workflow: parsed.workflow as RoutedWorkflow,
      query: typeof parsed.query === 'string' ? parsed.query : '',
    };
  } catch {
    return null;
  }
}
