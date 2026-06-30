// Decision-pause evidence on the session-ledger (buildout F6 — the decision store fold).
//
// The live pending/resolved/expired packets under .paqad/decisions/ are the TEETH
// (decision-pause-gate.mjs + ImplementationReviewGate block on an OPEN packet) and
// STAY untouched — they remain the operational source the gates read. Only the
// decision LIFECYCLE EVENTS fold onto the #249 session-ledger as `decision-evidence`
// rows, so the dashboard (and, later, the SIEM fold-view) read the decision feed
// from the always-on ledger instead of scanning the packet directories.
//
// Decisions are PROJECT-level and outlive a single conversation, so the rows ride
// the project sentinel "session". Each lifecycle transition appends one row keyed by
// decision id; the current state is a per-id fold of the full history (latest event
// wins). This mirrors the on-disk buckets: a decision whose latest event is `opened`
// is pending; `resolved`/`superseded` live in the resolved bucket; `expired` in the
// expired bucket; `discarded` packets are removed and counted nowhere.

import { readProjectEvents, recordProjectEvent } from '@/session-ledger/project-ledger.js';

export const DECISION_EVIDENCE_DOC_TYPE = 'decision-evidence';
export const DECISION_EVIDENCE_SCHEMA_VERSION = 1;

export type DecisionEvidenceKind = 'opened' | 'resolved' | 'superseded' | 'discarded' | 'expired';

export interface DecisionOpenedFields {
  decisionId: string;
  category: string;
  /** The packet's human-readable question, used as the dashboard label. */
  title: string;
  /** The packet's ISO `created_at`, used to age the pending item. */
  createdAt: string;
}

/** Record a freshly minted pending packet (best-effort). */
export function recordDecisionOpened(projectRoot: string, fields: DecisionOpenedFields): void {
  recordProjectEvent(
    projectRoot,
    DECISION_EVIDENCE_DOC_TYPE,
    {
      kind: 'opened',
      decision_id: fields.decisionId,
      category: fields.category,
      title: fields.title,
      created_at: fields.createdAt,
    },
    DECISION_EVIDENCE_SCHEMA_VERSION,
  );
}

/**
 * Record a packet resolved by a human/rule/rag (best-effort). `status` distinguishes
 * a plain resolution from a delegation; both land in the resolved bucket. `resolver`
 * carries the short resolver token for the SIEM fold-view.
 */
export function recordDecisionResolved(
  projectRoot: string,
  decisionId: string,
  status: string,
  resolver: string,
): void {
  recordProjectEvent(
    projectRoot,
    DECISION_EVIDENCE_DOC_TYPE,
    { kind: 'resolved', decision_id: decisionId, status, resolver },
    DECISION_EVIDENCE_SCHEMA_VERSION,
  );
}

/** Record a packet superseded by a conflicting later resolution (best-effort). */
export function recordDecisionSuperseded(projectRoot: string, decisionId: string): void {
  recordProjectEvent(
    projectRoot,
    DECISION_EVIDENCE_DOC_TYPE,
    { kind: 'superseded', decision_id: decisionId },
    DECISION_EVIDENCE_SCHEMA_VERSION,
  );
}

/** Record a pending packet discarded with a reason (best-effort). */
export function recordDecisionDiscarded(
  projectRoot: string,
  decisionId: string,
  reason: string,
): void {
  recordProjectEvent(
    projectRoot,
    DECISION_EVIDENCE_DOC_TYPE,
    { kind: 'discarded', decision_id: decisionId, reason },
    DECISION_EVIDENCE_SCHEMA_VERSION,
  );
}

/** Record a resolved packet that aged past its TTL or was invalidated (best-effort). */
export function recordDecisionExpired(projectRoot: string, decisionId: string): void {
  recordProjectEvent(
    projectRoot,
    DECISION_EVIDENCE_DOC_TYPE,
    { kind: 'expired', decision_id: decisionId },
    DECISION_EVIDENCE_SCHEMA_VERSION,
  );
}

/** A pending decision reconstructed from the ledger. */
export interface DecisionEvidencePacket {
  id: string;
  title: string;
  /** ISO `created_at` from the `opened` row, or null when the row omitted it. */
  createdAt: string | null;
}

/** The current decision state folded from the `decision-evidence` history. */
export interface DecisionEvidenceState {
  pending: DecisionEvidencePacket[];
  resolvedCount: number;
  expiredCount: number;
}

/**
 * Fold the full `decision-evidence` history into the current per-id state. Rows are
 * read in append order, so the last row for an id is its current lifecycle event.
 */
export function readDecisionEvidence(projectRoot: string): DecisionEvidenceState {
  const latest = new Map<string, { kind: string; row: Record<string, unknown> }>();
  for (const row of readProjectEvents(projectRoot, DECISION_EVIDENCE_DOC_TYPE)) {
    const id = row.decision_id;
    const kind = row.kind;
    if (typeof id === 'string' && typeof kind === 'string') {
      latest.set(id, { kind, row });
    }
  }

  const pending: DecisionEvidencePacket[] = [];
  let resolvedCount = 0;
  let expiredCount = 0;
  for (const [id, { kind, row }] of latest) {
    if (kind === 'opened') {
      const title = typeof row.title === 'string' && row.title.length > 0 ? row.title : id;
      const createdAt =
        typeof row.created_at === 'string' && row.created_at.length > 0 ? row.created_at : null;
      pending.push({ id, title, createdAt });
    } else if (kind === 'resolved' || kind === 'superseded') {
      resolvedCount += 1;
    } else if (kind === 'expired') {
      expiredCount += 1;
    }
  }
  return { pending, resolvedCount, expiredCount };
}
