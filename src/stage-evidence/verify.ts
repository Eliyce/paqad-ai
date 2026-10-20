import {
  appendFeatureStageRow,
  currentFeature,
  foldFeature,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import { type SessionLedgerRow } from '@/session-ledger/ledger.js';

import { resolveSessionId } from '@/rag-ledger/session.js';
import { agentForWriter } from './agent-identity.js';
import { type OrderingViolation, type StageCompletenessVerdict } from './types.js';

export const REDO_CAP = 2;

export interface VerifyResult {
  verdict: StageCompletenessVerdict;
  ok: boolean;
  blocked: boolean;
  live_marked: boolean;
  missing_stages: string[];
  ordering_violations: OrderingViolation[];
  redo_attempts: number;
  change_key: string;
}

export interface VerifyContext {
  sessionId?: string | null;
  dirName?: string;
  adapter: string;
  now?: () => Date;
}

export function verifyChange(projectRoot: string, ctx: VerifyContext): VerifyResult {
  const sessionId = resolveSessionId(projectRoot, ctx.sessionId);
  const dirName = ctx.dirName ?? currentFeatureOrThrow(projectRoot, sessionId);
  const fold = foldFeature(projectRoot, sessionId, dirName);

  const unit = readFeatureStageUnit(projectRoot, dirName);
  const lastMutationIdx = lastIndexOfMutation(unit);
  const priorFailures = unit
    .slice(lastMutationIdx + 1)
    .filter((row) => row.kind === 'verify' && row.event_status === 'failed').length;
  const liveMarked = unit.some((row) => row.evidence_source === 'live-mark');

  let verdict = fold.completeness.verdict;
  if (verdict === 'incomplete' && priorFailures >= REDO_CAP) {
    verdict = 'blocked';
  }
  const ok = verdict === 'complete' || verdict === 'recovered';
  const blocked = verdict === 'blocked';

  appendFeatureStageRow(
    projectRoot,
    sessionId,
    dirName,
    {
      kind: 'verify',
      agent: agentForWriter(ctx.adapter),
      event_status: ok ? 'completed' : 'failed',
      note: `verdict=${verdict}; missing=[${fold.completeness.missing_stages.join(',')}]`,
    },
    ctx.now,
  );

  return {
    verdict,
    ok,
    blocked,
    live_marked: liveMarked,
    missing_stages: fold.completeness.missing_stages,
    ordering_violations: fold.completeness.ordering_violations,
    redo_attempts: priorFailures,
    change_key: fold.change_key,
  };
}

function currentFeatureOrThrow(projectRoot: string, sessionId: string): string {
  const dirName = currentFeature(projectRoot, sessionId);
  if (!dirName) {
    throw new Error('No open stage-evidence change to verify (call `open` first).');
  }
  return dirName;
}

function lastIndexOfMutation(unit: readonly SessionLedgerRow[]): number {
  let idx = -1;
  for (let i = 0; i < unit.length; i++) {
    const kind = unit[i].kind;
    if (kind === 'open' || kind === 'stage_start' || kind === 'stage_end') idx = i;
  }
  return idx;
}
