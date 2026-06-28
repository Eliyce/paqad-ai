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
  appendSessionEvent,
  currentOrdinal,
  readSessionUnit,
  type SessionLedgerRow,
} from '@/session-ledger/ledger.js';

import { foldChange } from './fold.js';
import { validateStageEvidenceRow } from './schema.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import {
  STAGE_EVIDENCE_DOC_TYPE,
  STAGE_EVIDENCE_SCHEMA_VERSION,
  type OrderingViolation,
  type StageCompletenessVerdict,
} from './types.js';

/** Failed-verify attempts after which an incomplete change is `blocked` (escalate). */
export const REDO_CAP = 2;

export interface VerifyResult {
  verdict: StageCompletenessVerdict;
  /** True when the change may proceed to delivery (verdict complete | recovered). */
  ok: boolean;
  /** True when the redo cap was hit — escalate to the Decision Pause Contract. */
  blocked: boolean;
  missing_stages: string[];
  ordering_violations: OrderingViolation[];
  redo_attempts: number;
  change_key: string;
}

export interface VerifyContext {
  sessionId?: string | null;
  ordinal?: number;
  adapter: string;
  now?: () => Date;
}

/**
 * Run the completeness gate for a change and record the verdict. Deterministic: the
 * verdict comes only from the folded event rows, never from assertion.
 */
export function verifyChange(projectRoot: string, ctx: VerifyContext): VerifyResult {
  const sessionId = resolveSessionId(projectRoot, ctx.sessionId);
  const ordinal = ctx.ordinal ?? currentOrdinalOrThrow(projectRoot, sessionId);
  const fold = foldChange(projectRoot, sessionId, ordinal);

  const priorFailures = readSessionUnit(
    projectRoot,
    STAGE_EVIDENCE_DOC_TYPE,
    sessionId,
    ordinal,
  ).filter((row) => row.kind === 'verify' && row.event_status === 'failed').length;

  let verdict = fold.completeness.verdict;
  if (verdict === 'incomplete' && priorFailures >= REDO_CAP) {
    verdict = 'blocked';
  }
  const ok = verdict === 'complete' || verdict === 'recovered';
  const blocked = verdict === 'blocked';

  appendSessionEvent(
    projectRoot,
    STAGE_EVIDENCE_DOC_TYPE,
    sessionId,
    ordinal,
    {
      kind: 'verify',
      conversation_ordinal: ordinal,
      adapter: ctx.adapter,
      event_status: ok ? 'completed' : 'failed',
      note: `verdict=${verdict}; missing=[${fold.completeness.missing_stages.join(',')}]`,
    },
    {
      schemaVersion: STAGE_EVIDENCE_SCHEMA_VERSION,
      validate: (row: SessionLedgerRow) => validateStageEvidenceRow(row),
      now: ctx.now,
    },
  );

  return {
    verdict,
    ok,
    blocked,
    missing_stages: fold.completeness.missing_stages,
    ordering_violations: fold.completeness.ordering_violations,
    redo_attempts: priorFailures,
    change_key: fold.change_key,
  };
}

function currentOrdinalOrThrow(projectRoot: string, sessionId: string): number {
  const ordinal = currentOrdinal(projectRoot, STAGE_EVIDENCE_DOC_TYPE, sessionId);
  if (ordinal <= 0) {
    throw new Error('No open stage-evidence change to verify (call `open` first).');
  }
  return ordinal;
}
