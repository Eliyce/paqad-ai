// Session-owned end-of-turn enforcement (issue #582).
//
// The in-session completion seam runs for EVERY session on the project, but only the
// session that made a change owes that change's checks. Before this module the seam
// enforced by default and tried to prove a turn was "not feature-development" from state
// the whole repo shares (the git tree, the branch, a single-slot session id, the route
// pointer), so a question asked in one session was held to another session's change.
//
// This flips the default. A session is checked at Stop only when it OWNS a change: some
// unclosed bundle holds a stage row stamped with this session's id and written by the
// agent (`live-mark` / `redo`). Hook- and backstop-inferred rows (`inferred-git`,
// `inferred-artifact`) are never ownership, since no agent claimed them. The route is a
// secondary signal: it can turn a detour off, but it can never make a non-owner enforce.
//
// Read-only by design. It lists in-flight bundles and reads their rows directly, and never
// calls `currentFeature` / `reconcileSessionControl`, so a Stop can no longer repoint a
// session at another session's bundle. Write-path adoption (#404) is untouched.

import { listInFlightFeatures } from '@/feature-evidence/adoption.js';
import { rowRecordedAt } from '@/feature-evidence/envelope.js';
import { readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';

import { isFeatureDevelopmentRoute, type RoutedWorkflow } from './routed-workflow.js';
import { readWorkflowState, type WorkflowState } from './workflow-state.js';

/** Why the completion check skips a turn. */
export type CompletionSkipReason = 'not-owner' | 'detour';

/** Why the completion check enforces a turn. */
export type CompletionEnforceReason =
  'edited-this-turn' | 'owner-feature-dev' | 'owner-unknown-route';

/** The completion decision: a skip carries a skip reason, an enforce an enforce reason. */
export type CompletionEnforcement = (
  | { enforce: false; reason: CompletionSkipReason }
  | { enforce: true; reason: CompletionEnforceReason }
) & {
  /** The ACTIVE routed workflow, when one is recorded; used to name the skip verdict. */
  activeWorkflow: RoutedWorkflow | null;
};

const AGENT_AUTHORED_SOURCES = new Set(['live-mark', 'redo']);

/**
 * Every agent-authored stage row `sessionId` wrote into an unclosed bundle, across all
 * branches. Tolerant: an absent or unreadable bundle contributes no rows, and a failure to
 * list bundles at all reads as none.
 */
export function sessionOwnedRows(projectRoot: string, sessionId: string): SessionLedgerRow[] {
  let dirNames: string[];
  try {
    dirNames = listInFlightFeatures(projectRoot);
  } catch {
    return [];
  }
  return dirNames.flatMap((dirName) =>
    readFeatureStageUnit(projectRoot, dirName).filter(
      (row) =>
        row.session_id === sessionId &&
        typeof row.evidence_source === 'string' &&
        AGENT_AUTHORED_SOURCES.has(row.evidence_source),
    ),
  );
}

/**
 * Whether any owned row was written during the current turn. A row counts when its time
 * (`recorded_at`, or `ts` on a row written before #581)
 * is at or after the turn stamp and it was not recorded against a session id read from the
 * shared cache file (a CLI call that resolved the wrong session must never make this one
 * enforce). With no usable stamp (a state file written before it existed) this falls back
 * to ownership alone, which is today's behaviour for an owner.
 */
function editedThisTurn(owned: readonly SessionLedgerRow[], state: WorkflowState): boolean {
  const turnStart = state.turn_started_at === undefined ? NaN : Date.parse(state.turn_started_at);
  if (Number.isNaN(turnStart)) {
    return owned.length > 0;
  }
  return owned.some((row) => {
    if (row.session_source === 'cache') {
      return false;
    }
    const at = Date.parse(rowRecordedAt(row) ?? '');
    return !Number.isNaN(at) && at >= turnStart;
  });
}

/**
 * Decide whether the completion seam verifies this session's turn:
 *
 * | owns | edited this turn | active route  | result                          |
 * |------|------------------|---------------|---------------------------------|
 * | no   | -                | any           | skip (`not-owner`)              |
 * | yes  | yes              | any           | enforce (`edited-this-turn`)    |
 * | yes  | no               | feature-dev   | enforce (`owner-feature-dev`)   |
 * | yes  | no               | none recorded | enforce (`owner-unknown-route`) |
 * | yes  | no               | non-feature   | skip (`detour`)                 |
 *
 * Only the ACTIVE route entry is read. A paused feature-development entry does not keep a
 * session enforcing: the paused change is checked again on the turn that resumes it.
 * Best-effort: unreadable rows read as none (so a non-owner skips) and an unreadable state
 * reads as no route (so an owner enforces).
 */
export function classifyCompletionEnforcement(
  projectRoot: string,
  sessionId?: string | null,
): CompletionEnforcement {
  let resolved: string;
  try {
    resolved = resolveSessionId(projectRoot, sessionId ?? null);
    /* v8 ignore next 3 -- resolveSessionId swallows its own fs errors; kept so any future
       throw reads as "owns nothing" instead of crashing the completion seam. */
  } catch {
    return { enforce: false, reason: 'not-owner', activeWorkflow: null };
  }
  const state = readWorkflowState(projectRoot, resolved);
  const activeWorkflow = state.active?.workflow ?? null;
  const owned = sessionOwnedRows(projectRoot, resolved);

  if (owned.length === 0) {
    return { enforce: false, reason: 'not-owner', activeWorkflow };
  }
  if (editedThisTurn(owned, state)) {
    return { enforce: true, reason: 'edited-this-turn', activeWorkflow };
  }
  if (activeWorkflow === null) {
    return { enforce: true, reason: 'owner-unknown-route', activeWorkflow };
  }
  if (isFeatureDevelopmentRoute(activeWorkflow)) {
    return { enforce: true, reason: 'owner-feature-dev', activeWorkflow };
  }
  return { enforce: false, reason: 'detour', activeWorkflow };
}
