// Prompt-seam routing (issues #324, #336).
//
// Wires the EXISTING deterministic classify→route engine into the live session: it
// runs `RequestClassifier` on the prompt text, folds the fine-grained workflow into
// one of the 9 routing outcomes (`resolveRoutedWorkflow`), and — only for the
// `feature-development` outcome — asks `PipelineRouter` for the lane. No new
// classifier, no LLM call.
//
// The seam (`runPromptRouteSeam`) is what the UserPromptSubmit hook calls each
// message: it resolves the outcome, records it in the per-session workflow-state
// (pausing/resuming per #336), stashes the lane for the next change-open (feature-
// development only), and returns a lean `▸ paqad`-style line naming the outcome.
// `no-workflow` (small talk) stashes nothing and narrates nothing.

import type { ClassificationResult } from '@/core/types/classification.js';
import type { Lane } from '@/core/types/routing.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { writePendingLane } from '@/stage-evidence/pending-lane.js';

import { RequestClassifier } from './classifier.js';
import { PipelineRouter } from './router.js';
import {
  isFeatureDevelopmentRoute,
  resolveRoutedWorkflow,
  type RoutedWorkflow,
} from './routed-workflow.js';
import { writeSessionRoute } from './session-route.js';
import {
  readWorkflowState,
  routeWorkflow,
  writeWorkflowState,
  type WorkflowEntry,
} from './workflow-state.js';

/** Plain-language, lane-specific reason (paqad voice — no internal jargon). */
const LANE_REASON: Record<Lane, string> = {
  fast: 'small, low-risk change — quick path, no full spec needed',
  graduated: 'a moderate change — I set up spec-before-build for it',
  full: 'risky or wide-reaching — full path (spec → build → verify)',
};

/** Plain-language reason per routing outcome (paqad voice). */
const ROUTE_REASON: Record<RoutedWorkflow, string> = {
  'feature-development': 'a code change — the full build path',
  'project-question': 'a question about the project — no code change',
  'documentation-update': 'creating or refreshing the project documentation',
  'module-documentation': 'documenting a module',
  pentest: 'a security test of the app',
  'design-test': 'auditing the UI against the design system',
  'rules-analyze': 'analysing which rules can become scripts',
  'root-cause-analysis': 'a post-incident root-cause analysis',
  'no-workflow': 'just chatting — nothing to set up',
};

/** Injectable classify/route seam, so the outcome→lane branches are all testable. */
export interface PromptRouteDeps {
  classify?: (input: { request: string }) => Promise<ClassificationResult>;
  route?: (classification: ClassificationResult) => { lane: Lane | null };
}

export interface PromptRouteResult {
  /** The chosen routing outcome (one of the 9). */
  routed: RoutedWorkflow;
  /** The lane — non-null ONLY for the feature-development outcome. */
  lane: Lane | null;
  /** Plain-language reason for the pick. */
  reason: string;
}

/**
 * Resolve the routing outcome for a prompt using the deterministic classifier, and
 * (only for feature-development) the lane from the router. Non-feature-development
 * outcomes get `lane: null` — no lane is chosen for them (#336). Never throws: this
 * is called from a best-effort hook seam.
 */
export async function resolvePromptRoute(
  projectRoot: string,
  request: string,
  deps: PromptRouteDeps = {},
): Promise<PromptRouteResult> {
  const classify =
    deps.classify ?? ((input) => new RequestClassifier({ projectRoot }).classify(input));
  const route = deps.route ?? ((classification) => new PipelineRouter().route(classification));

  const classification = await classify({ request });
  const routed = resolveRoutedWorkflow(classification.workflow);
  if (!isFeatureDevelopmentRoute(routed)) {
    return { routed, lane: null, reason: ROUTE_REASON[routed] };
  }
  const { lane } = route(classification);
  return {
    routed,
    lane,
    reason: lane === null ? ROUTE_REASON['feature-development'] : LANE_REASON[lane],
  };
}

export interface PromptRouteSeamInput {
  projectRoot: string;
  request: string;
  sessionId: string | null;
  adapter: string;
}

export interface PromptRouteSeamResult {
  routed: RoutedWorkflow;
  lane: Lane | null;
  /** The paused entry that was resumed on this message, or null. */
  resumed: WorkflowEntry | null;
  /** The `▸ paqad` line to surface, or null when there is nothing to say. */
  narration: string | null;
}

/** Build the narration line for a routed outcome (null for silent no-workflow). */
function narrateRoute(
  routed: RoutedWorkflow,
  lane: Lane | null,
  reason: string,
  resumed: WorkflowEntry | null,
): string | null {
  if (routed === 'no-workflow') {
    return null;
  }
  const verb = resumed ? 'Resumed' : 'Routed to';
  if (routed === 'feature-development' && lane !== null) {
    return `[paqad] ${verb} feature-development — ${lane} lane (${reason}).`;
  }
  return `[paqad] ${verb} ${routed} — ${reason}.`;
}

/**
 * The prompt-seam entry point (called from the UserPromptSubmit hook every message).
 * Resolves the outcome, records it in the per-session workflow-state (pause/resume),
 * stashes the lane for the next change-open (feature-development only), and returns a
 * lean narration line. `no-workflow` records the state but narrates nothing.
 */
export async function runPromptRouteSeam(
  input: PromptRouteSeamInput,
  deps: PromptRouteDeps = {},
): Promise<PromptRouteSeamResult> {
  const { routed, lane, reason } = await resolvePromptRoute(input.projectRoot, input.request, deps);
  const sessionId = resolveSessionId(input.projectRoot, input.sessionId);

  // Record the outcome as evidence and preserve pause/resume across messages (#336).
  const prior = readWorkflowState(input.projectRoot, sessionId);
  const anchors = lane === null ? {} : { lane };
  const transition = routeWorkflow(prior, routed, anchors);
  writeWorkflowState(input.projectRoot, sessionId, transition.state);

  // The lane is stashed for the change-open ONLY on the feature-development route.
  if (isFeatureDevelopmentRoute(routed) && lane !== null) {
    writePendingLane(input.projectRoot, sessionId, lane);
  }

  // Hand the routed workflow + prompt to the detached context worker (#336) so it
  // loads rules only for feature-development, seeds retrieval with the prompt, and
  // retrieves nothing for no-workflow.
  writeSessionRoute(input.projectRoot, { workflow: routed, query: input.request });

  return {
    routed,
    lane,
    resumed: transition.resumed,
    narration: narrateRoute(routed, lane, reason, transition.resumed),
  };
}
