import { resolveSessionId } from '@/rag-ledger/session.js';

import { isFeatureDevelopmentRoute } from './routed-workflow.js';
import { readSessionRoute } from './session-route.js';
import { readWorkflowState } from './workflow-state.js';

export function routeIsAffirmativelyNonFeature(
  projectRoot: string,
  sessionId?: string | null,
): boolean {
  const resolved = resolveSessionId(projectRoot, sessionId);
  const active = readWorkflowState(projectRoot, resolved).active?.workflow;
  if (active) {
    return !isFeatureDevelopmentRoute(active);
  }
  const routed = readSessionRoute(projectRoot, resolved)?.workflow;
  if (routed) {
    return !isFeatureDevelopmentRoute(routed);
  }
  return false;
}
