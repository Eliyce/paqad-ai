import { readProjectEvents, recordProjectEvent } from '@/session-ledger/project-ledger.js';

export const DECISION_EVIDENCE_DOC_TYPE = 'decision-evidence';
export const DECISION_EVIDENCE_SCHEMA_VERSION = 1;

export type DecisionEvidenceKind = 'opened' | 'resolved' | 'superseded' | 'discarded' | 'expired';

export interface DecisionOpenedFields {
  decisionId: string;
  category: string;
  title: string;
  createdAt: string;
}

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

export function recordDecisionSuperseded(projectRoot: string, decisionId: string): void {
  recordProjectEvent(
    projectRoot,
    DECISION_EVIDENCE_DOC_TYPE,
    { kind: 'superseded', decision_id: decisionId },
    DECISION_EVIDENCE_SCHEMA_VERSION,
  );
}

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

export function recordDecisionExpired(projectRoot: string, decisionId: string): void {
  recordProjectEvent(
    projectRoot,
    DECISION_EVIDENCE_DOC_TYPE,
    { kind: 'expired', decision_id: decisionId },
    DECISION_EVIDENCE_SCHEMA_VERSION,
  );
}

export interface DecisionEvidencePacket {
  id: string;
  title: string;
  createdAt: string | null;
}

export interface DecisionEvidenceState {
  pending: DecisionEvidencePacket[];
  resolvedCount: number;
  expiredCount: number;
}

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
