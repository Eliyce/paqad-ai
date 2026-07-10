// End-of-change completeness gate (issue #247 §6). Folds a change's events, decides
// whether every mandatory stage ran (in order), writes a `kind:verify` row recording
// the verdict, and returns the result the CLI maps to an exit code:
//   - complete / recovered  → exit 0, proceed to delivery
//   - incomplete            → exit 1, drive a bounded redo (re-run the missing stage)
//   - blocked               → exit 1, redo cap hit → escalate to a Decision Packet
//
// "Redo" is a gate, not autonomous re-execution (no executor exists): the agent
// re-runs the missing stage and must produce a fresh, in-window artifact — it cannot
// satisfy the gate by assertion. The cap (2 failed verifies) bounds the loop.

import {
  appendFeatureStageRow,
  currentFeature,
  foldFeature,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import { type SessionLedgerRow } from '@/session-ledger/ledger.js';

import { resolveSessionId } from '@/rag-ledger/session.js';
import { type OrderingViolation, type StageCompletenessVerdict } from './types.js';

/** Failed-verify attempts after which an incomplete change is `blocked` (escalate). */
export const REDO_CAP = 2;

export interface VerifyResult {
  verdict: StageCompletenessVerdict;
  /** True when the change may proceed to delivery (verdict complete | recovered). */
  ok: boolean;
  /** True when the redo cap was hit — escalate to the Decision Pause Contract. */
  blocked: boolean;
  /** True when the agent actually marked at least one stage live (`live-mark`),
   *  i.e. the workflow was in use. Distinguishes "started the workflow but left it
   *  incomplete" (a hard failure) from "never marked anything" (informational, so
   *  the gate cannot break a project that has not adopted stage marking yet). */
  live_marked: boolean;
  missing_stages: string[];
  ordering_violations: OrderingViolation[];
  redo_attempts: number;
  change_key: string;
}

export interface VerifyContext {
  sessionId?: string | null;
  /** Feature dir to verify; resolved from the active `_session` control when absent. */
  dirName?: string;
  adapter: string;
  now?: () => Date;
}

/**
 * Run the completeness gate for a change and record the verdict. Deterministic: the
 * verdict comes only from the folded event rows, never from assertion.
 */
export function verifyChange(projectRoot: string, ctx: VerifyContext): VerifyResult {
  const sessionId = resolveSessionId(projectRoot, ctx.sessionId);
  const dirName = ctx.dirName ?? currentFeatureOrThrow(projectRoot, sessionId);
  const fold = foldFeature(projectRoot, sessionId, dirName);

  const unit = readFeatureStageUnit(projectRoot, dirName);
  // Redo cap counts only failed verifies SINCE the last ledger mutation (issue #321):
  // a new stage row (open / stage_start / stage_end) is fresh work, so it resets the
  // count. This makes the cap meaningful across a re-verified change — the agent that
  // actually re-runs the missing stage is not punished by earlier failures — and keeps
  // #303 bite-once (repeated Stops with no new work still march toward `blocked`).
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
      adapter: ctx.adapter,
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

/** The active feature dir, or throw when none is open — verify needs a change. */
function currentFeatureOrThrow(projectRoot: string, sessionId: string): string {
  const dirName = currentFeature(projectRoot, sessionId);
  if (!dirName) {
    throw new Error('No open stage-evidence change to verify (call `open` first).');
  }
  return dirName;
}

/** Index of the last stage-mutation row (open / stage_start / stage_end) in the unit,
 *  or -1 when none — the boundary after which redo-cap failures are counted (#321). */
function lastIndexOfMutation(unit: readonly SessionLedgerRow[]): number {
  let idx = -1;
  for (let i = 0; i < unit.length; i++) {
    const kind = unit[i].kind;
    if (kind === 'open' || kind === 'stage_start' || kind === 'stage_end') idx = i;
  }
  return idx;
}
