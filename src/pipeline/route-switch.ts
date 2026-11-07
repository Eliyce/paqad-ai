import { appendHooksLog } from '@/core/logging/hooks-log.js';
import { clearPendingLane } from '@/stage-evidence/pending-lane.js';

import { appendRouteOverride, type RouteOverrideSource } from './route-override-log.js';
import { isFeatureDevelopmentRoute, type RoutedWorkflow } from './routed-workflow.js';
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

export function writeRouteCorrection(
  root: string,
  sessionId: string,
  target: RoutedWorkflow,
  audit: { source?: RouteOverrideSource; reason?: string } = {},
): RoutedWorkflow | null {
  const state = readWorkflowState(root, sessionId);
  const priorRoute = readSessionRoute(root, sessionId);
  const hookLabel = state.active?.workflow ?? priorRoute?.workflow ?? null;

  writeWorkflowState(root, sessionId, correctedState(state, target));
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
