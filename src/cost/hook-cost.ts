import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { readRouteTurns } from '@/pipeline/route-turns.js';
import { readWorkflowState } from '@/pipeline/workflow-state.js';
import { hookSessionCandidates, resolveHookSession } from '@/rag-ledger/session.js';

import {
  changeCostWindow,
  computeChangeCost,
  updateCostCache,
  updateSessionCostCache,
  writeChangeCost,
  type CostHookPayload,
} from './change-cost.js';

export interface RefreshChangeCostInput {
  projectRoot: string;
  payload: CostHookPayload;
  now?: () => Date;
}

export type RefreshChangeCostOutcome = 'written' | 'no-feature' | 'no-window' | 'no-sources';

export function refreshChangeCostFromHook(input: RefreshChangeCostInput): RefreshChangeCostOutcome {
  const sessionId = resolveHookSession(input.projectRoot, input.payload);
  const dirName = currentFeature(input.projectRoot, sessionId);
  if (!dirName) {
    keepSessionTranscript(
      input,
      hookSessionCandidates(input.projectRoot, input.payload)[0] ?? sessionId,
    );
    return 'no-feature';
  }
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
  if (record.sources === 0) return 'no-sources';
  writeChangeCost(input.projectRoot, dirName, record, sessionId);
  return 'written';
}

function sessionFloor(projectRoot: string, sessionId: string, now: () => Date): string {
  return (
    readRouteTurns(projectRoot, sessionId)[0]?.at ??
    readWorkflowState(projectRoot, sessionId).turn_started_at ??
    now().toISOString()
  );
}

function keepSessionTranscript(input: RefreshChangeCostInput, sessionId: string): void {
  updateSessionCostCache({
    projectRoot: input.projectRoot,
    sessionId,
    payload: input.payload,
    floor: sessionFloor(input.projectRoot, sessionId, input.now ?? (() => new Date())),
  });
}
