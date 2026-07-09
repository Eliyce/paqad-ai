// Prompt-seam lane resolution (issue #324).
//
// Wires the EXISTING deterministic classify→route engine into the live session: it
// runs `RequestClassifier` + `PipelineRouter` on the prompt text and returns the
// lane they pick. No new classifier, no LLM call — the pipeline is already
// deterministic (prompt-text signal extraction → complexity/risk → selectLane).
//
// The seam (`runPromptLaneSeam`) is what the UserPromptSubmit hook calls: it
// resolves the lane, stashes it for the next change-open (so the ledger records the
// lane the classifier chose), and returns a lean `▸ paqad` line naming the lane. A
// prompt that matches no workflow routes to `lane: null` (a question, not a code
// change) — the seam stashes nothing and narrates nothing.

import type { Lane } from '@/core/types/routing.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { writePendingLane } from '@/stage-evidence/pending-lane.js';

import { RequestClassifier } from './classifier.js';
import { PipelineRouter } from './router.js';

export interface PromptLaneResult {
  /** The routed lane, or null when the prompt is not a code change. */
  lane: Lane | null;
  /** Plain-language reason for the chosen lane. */
  reason: string;
}

/** Plain-language, lane-specific reason (paqad voice — no internal jargon). */
const LANE_REASON: Record<Lane, string> = {
  fast: 'small, low-risk change — quick path, no full spec needed',
  graduated: 'a moderate change — I set up spec-before-build for it',
  full: 'risky or wide-reaching — full path (spec → build → verify)',
};

/**
 * Resolve the lane for a prompt using the deterministic classifier + router. Returns
 * `lane: null` when the request matches no code workflow (a question). Never throws:
 * this is called from a best-effort hook seam.
 */
export async function resolvePromptLane(
  projectRoot: string,
  request: string,
): Promise<PromptLaneResult> {
  const classification = await new RequestClassifier({ projectRoot }).classify({ request });
  const { lane } = new PipelineRouter().route(classification);
  return { lane, reason: lane === null ? 'no code change detected' : LANE_REASON[lane] };
}

export interface PromptLaneSeamInput {
  projectRoot: string;
  request: string;
  sessionId: string | null;
  adapter: string;
}

export interface PromptLaneSeamResult {
  lane: Lane | null;
  /** The `▸ paqad` line to surface, or null when there is nothing to say. */
  narration: string | null;
}

/**
 * The prompt-seam entry point (called from the UserPromptSubmit hook). Resolves the
 * lane, stashes it for the next change-open, and returns a lean narration line. A
 * non-code prompt (lane null) stashes nothing and returns null narration.
 */
export async function runPromptLaneSeam(input: PromptLaneSeamInput): Promise<PromptLaneSeamResult> {
  const { lane, reason } = await resolvePromptLane(input.projectRoot, input.request);
  if (lane === null) {
    return { lane: null, narration: null };
  }
  const sessionId = resolveSessionId(input.projectRoot, input.sessionId);
  writePendingLane(input.projectRoot, sessionId, lane);
  return {
    lane,
    narration: `[paqad] Routed to the ${lane} lane — ${reason}.`,
  };
}
