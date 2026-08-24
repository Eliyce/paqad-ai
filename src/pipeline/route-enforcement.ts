// Route classifier for END-OF-CHANGE ENFORCEMENT (issue #499).
//
// The completion backstop must run NO checks when the session never routed to
// feature-development: a question, a pentest, a docs task, an RCA, or small talk
// owes no planning/spec/review/checks stages, so a dirty working tree swept up by
// the `git status` fallback must not be forced through them. The route is already
// recorded per message (the UserPromptSubmit seam writes per-session workflow-state);
// this classifier is the enforcement-grade signal the short-circuit consumes.
//
// It is deliberately NOT `routeIsAffirmativelyNonFeature` (route-gate.ts, issue #390):
// that emission gate consults only the `active` entry and falls back to the
// session-agnostic route pointer — both wrong here (a paused feature-development change
// must still enforce, and an unknown route must NOT skip). It is also not the private
// `sessionRoutedToFeatureDevelopment` boolean in capability.ts, which cannot distinguish
// "no route state" (fail-closed) from "affirmatively non-feature" (skip). So this reads
// BOTH active and paused entries and returns a three-way verdict.

import { resolveSessionId } from '@/rag-ledger/session.js';

import { isFeatureDevelopmentRoute } from './routed-workflow.js';
import type { RoutedWorkflow } from './routed-workflow.js';
import { readWorkflowState } from './workflow-state.js';

/**
 * The enforcement verdict for a session's route:
 *  - `feature-dev`  — the active OR any paused entry is feature-development; enforce.
 *  - `non-feature`  — route state exists with entries, none feature-development; may skip.
 *  - `unknown`      — no route state on disk (absent / empty / unreadable); NEVER skip
 *                     (fail-closed), so providers whose seams do not write route state
 *                     keep today's behaviour unchanged.
 */
export type SessionRouteEnforcement = 'feature-dev' | 'non-feature' | 'unknown';

export interface SessionRouteEnforcementResult {
  verdict: SessionRouteEnforcement;
  /** The active routed workflow, when one is recorded; used to name the skip verdict. */
  activeWorkflow: RoutedWorkflow | null;
}

/**
 * Classify the session's route for end-of-change enforcement. Best-effort: the
 * underlying state read never throws, and any unexpected failure degrades to
 * `unknown` so the caller fails closed and runs the full verification.
 */
export function classifySessionRouteForEnforcement(
  projectRoot: string,
  sessionId?: string | null,
): SessionRouteEnforcementResult {
  try {
    const resolved = resolveSessionId(projectRoot, sessionId ?? null);
    const state = readWorkflowState(projectRoot, resolved);
    const activeWorkflow = state.active?.workflow ?? null;

    const featureDev =
      (state.active !== null && isFeatureDevelopmentRoute(state.active.workflow)) ||
      state.paused.some((entry) => isFeatureDevelopmentRoute(entry.workflow));
    if (featureDev) {
      return { verdict: 'feature-dev', activeWorkflow };
    }

    // State with at least one entry, none feature-development → affirmatively non-feature.
    // An empty default (no active, no paused) is indistinguishable from an absent or
    // corrupt file, so it reads `unknown` and fails closed.
    const hasEntry = state.active !== null || state.paused.length > 0;
    return { verdict: hasEntry ? 'non-feature' : 'unknown', activeWorkflow };
    /* c8 ignore next 4 -- INV-1 fail-closed net: both reads swallow their own errors, so
       this outer catch is unreachable in practice; kept so any future throw degrades to
       `unknown` (run the full verification) rather than crashing the completion seam. */
  } catch {
    return { verdict: 'unknown', activeWorkflow: null };
  }
}
