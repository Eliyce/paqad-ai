// Route gate for feature-evidence emission (issue #390).
//
// Feature-evidence artifacts (the `feature-evidence/change-<ULID>/` bundle,
// `stage-evidence.jsonl`, `report.html`, `receipt.json`, `ai-bom.json`, `rag.jsonl`,
// and `_session/<id>.json`) must be created ONLY for the feature-development route.
// Both the marker-driven auto-open (`parseAndRecordMarkers` → recorder) and the
// report/receipt render (`run-repository-verification`) used to gate only on "is a
// feature pointer active?", never on the routed workflow, so any workflow that emitted
// `paqad:stage` markers minted a bundle. This helper is the single route signal both
// seams consult — derived from the PERSISTED route (`isFeatureDevelopmentRoute`), never
// from the working-tree diff (`changeIsFeatureDev`).

import { resolveSessionId } from '@/rag-ledger/session.js';

import { isFeatureDevelopmentRoute } from './routed-workflow.js';
import { readSessionRoute } from './session-route.js';
import { readWorkflowState } from './workflow-state.js';

/**
 * Whether the session's route AFFIRMATIVELY resolves to a NON-feature-development
 * workflow. True only when route state EXISTS and names a route that is not
 * feature-development (the per-session workflow-state `active` entry first, falling
 * back to the session-agnostic route pointer the prompt seam drops).
 *
 * Absent route state returns `false` on purpose — "unknown", never "non-feature".
 * Only Claude's UserPromptSubmit seam (`runPromptRouteSeam`) writes route state, so a
 * Codex/Gemini session records stage markers through the same recorder but has no route
 * state; treating that absence as non-feature would kill all cross-provider
 * feature-evidence. Suppression therefore fires only on a route we can PROVE is
 * non-feature, and an unknown route preserves prior recording behaviour. Best-effort:
 * the state reads never throw, so this never wedges a hook.
 */
export function routeIsAffirmativelyNonFeature(
  projectRoot: string,
  sessionId?: string | null,
): boolean {
  const resolved = resolveSessionId(projectRoot, sessionId);
  const active = readWorkflowState(projectRoot, resolved).active?.workflow;
  if (active) {
    return !isFeatureDevelopmentRoute(active);
  }
  const routed = readSessionRoute(projectRoot)?.workflow;
  if (routed) {
    return !isFeatureDevelopmentRoute(routed);
  }
  return false;
}
