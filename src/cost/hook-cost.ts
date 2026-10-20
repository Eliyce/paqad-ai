// The Stop and SubagentStop seam for the change cost (issue #639, Part 23).
//
// Lazy-imported by `runtime/hooks/lib/cost-refresh.mjs` at the end of
// `verification-completion.mjs` (Stop) and `stage-agent-completion.mjs` (SubagentStop), after
// each hook's decision is final. It records the transcript paths the payload names, reads what
// they gained since the last run, and rewrites the active change's `cost.json`. Record-only: it
// throws on a write fault so the hook can log it, and the hook's exit code and output never
// depend on it.

import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { resolveHookSession } from '@/rag-ledger/session.js';

import {
  changeCostWindow,
  computeChangeCost,
  updateCostCache,
  writeChangeCost,
  type CostHookPayload,
} from './change-cost.js';

export interface RefreshChangeCostInput {
  projectRoot: string;
  payload: CostHookPayload;
  now?: () => Date;
}

export type RefreshChangeCostOutcome = 'written' | 'no-feature' | 'no-window' | 'no-sources';

/** Record the payload's transcripts and rewrite the active change's `cost.json`. */
export function refreshChangeCostFromHook(input: RefreshChangeCostInput): RefreshChangeCostOutcome {
  const sessionId = resolveHookSession(input.projectRoot, input.payload);
  const dirName = currentFeature(input.projectRoot, sessionId);
  if (!dirName) return 'no-feature';
  const window = changeCostWindow(input.projectRoot, dirName, input.now);
  if (window === null) return 'no-window';
  updateCostCache({
    projectRoot: input.projectRoot,
    sessionId,
    dirName,
    payload: input.payload,
    floor: window.from,
  });
  const record = computeChangeCost(input.projectRoot, dirName, { now: input.now });
  if (record === null) return 'no-window';
  // No transcript known yet (a host that names none): no file, so the HUD keeps "not yet"
  // instead of showing a cost of zero tokens it never measured.
  if (record.sources === 0) return 'no-sources';
  writeChangeCost(input.projectRoot, dirName, record, sessionId);
  return 'written';
}
