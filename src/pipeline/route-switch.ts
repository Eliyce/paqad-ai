import { statSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { appendHooksLog } from '@/core/logging/hooks-log.js';
import { readLedgerSessionId } from '@/rag-ledger/session.js';
import { clearPendingLane } from '@/stage-evidence/pending-lane.js';

import { appendRouteOverride, type RouteOverrideSource } from './route-override-log.js';
import { isFeatureDevelopmentRoute, type RoutedWorkflow } from './routed-workflow.js';
import { appendRouteTurn, readRouteTurns } from './route-turns.js';
import { readSessionRoute, writeSessionRoute } from './session-route.js';
import { readWorkflowState, writeWorkflowState, type WorkflowState } from './workflow-state.js';

const FEATURE_ROUTE: RoutedWorkflow = 'feature-development';

export const ROUTE_SWITCHED_LINE =
  '**▸ paqad** · route set to feature-development: a change was opened in this session.';

function correctedState(state: WorkflowState, target: RoutedWorkflow): WorkflowState {
  const pausedIndex = state.paused.map((entry) => entry.workflow).lastIndexOf(target);
  if (pausedIndex === -1) {
    return { ...state, active: { workflow: target } };
  }
  return {
    ...state,
    active: state.paused[pausedIndex]!,
    paused: state.paused.filter((_, index) => index !== pausedIndex),
  };
}

/** A correction is a route turn of its own, stamped at the turn it corrects, so the corrected
 *  workflow's episode starts with that turn and rows written after the hook's misroute qualify. */
function appendCorrectionTurn(
  root: string,
  sessionId: string,
  target: RoutedWorkflow,
  turnStartedAt: string | undefined,
  now: () => Date,
): void {
  try {
    appendRouteTurn(root, sessionId, {
      at: turnStartedAt ?? now().toISOString(),
      workflow: target,
    });
  } catch (error) {
    appendHooksLog(
      root,
      `route-turns: append failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function writeRouteCorrection(
  root: string,
  sessionId: string,
  target: RoutedWorkflow,
  audit: { source?: RouteOverrideSource; reason?: string } = {},
  now: () => Date = () => new Date(),
): RoutedWorkflow | null {
  const state = readWorkflowState(root, sessionId);
  const priorRoute = readSessionRoute(root, sessionId);
  const hookLabel = state.active?.workflow ?? priorRoute?.workflow ?? null;

  writeWorkflowState(root, sessionId, correctedState(state, target));
  appendCorrectionTurn(root, sessionId, target, state.turn_started_at, now);
  writeSessionRoute(
    root,
    {
      workflow: target,
      query: priorRoute?.query ?? '',
      ...(priorRoute?.adapter === undefined ? {} : { adapter: priorRoute.adapter }),
    },
    sessionId,
  );
  if (!isFeatureDevelopmentRoute(target)) {
    clearPendingLane(root, sessionId);
  }
  appendRouteOverride(root, sessionId, {
    hookLabel,
    agentLabel: target,
    ...(audit.source === undefined ? {} : { source: audit.source }),
    ...(audit.reason === undefined ? {} : { reason: audit.reason }),
  });
  return hookLabel;
}

export function switchRouteToFeatureDevelopment(
  root: string,
  sessionId: string,
  source: RouteOverrideSource,
): boolean {
  if (readWorkflowState(root, sessionId).active?.workflow === FEATURE_ROUTE) {
    return false;
  }
  writeRouteCorrection(root, sessionId, FEATURE_ROUTE, { source });
  return true;
}

export function announceRouteSwitch(
  root: string,
  sessionId: string,
  source: RouteOverrideSource,
): void {
  try {
    if (switchRouteToFeatureDevelopment(root, sessionId, source)) {
      console.log(ROUTE_SWITCHED_LINE);
    }
  } catch (error) {
    appendHooksLog(
      root,
      `route-switch: ${source} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** How long the hooks' ledger-session cache counts as this session's id for a route switch. The
 *  hooks rewrite it on every prompt, so an older cache belongs to an idle or finished session. */
export const LEDGER_SESSION_RECENT_MS = 60 * 60 * 1000;

export const NO_SESSION_LINE =
  '**▸ paqad** · no session was identified, so the route stays as it is. Set SE_SESSION to ' +
  'this session id to move it.';

/** The session a stage start or lane set may switch the route for, in the hooks' order: the env
 *  hint (SE_SESSION, CLAUDE_SESSION_ID, CLAUDE_CODE_SESSION_ID), else the ledger-session cache
 *  when it is recent and the hooks wrote route turns for that session in this root (D6). */
export function routeSwitchSession(
  root: string,
  sessionHint: string | null,
  now: () => number = Date.now,
): string | null {
  const hinted = sessionHint?.trim();
  if (hinted) return hinted;
  const cached = readLedgerSessionId(root);
  if (cached === null) return null;
  try {
    const age = now() - statSync(join(root, PATHS.LEDGER_SESSION_ID)).mtimeMs;
    if (age > LEDGER_SESSION_RECENT_MS) return null;
  } catch {
    return null;
  }
  return readRouteTurns(root, cached).length > 0 ? cached : null;
}

/** Switches the route only for the session routeSwitchSession found before the command wrote
 *  anything (a stage write refreshes the cache, so it must be read first). */
export function announceRouteSwitchFor(
  root: string,
  sessionId: string,
  routeSession: string | null,
  source: RouteOverrideSource,
): void {
  if (routeSession !== sessionId) {
    console.log(NO_SESSION_LINE);
    return;
  }
  announceRouteSwitch(root, sessionId, source);
}
