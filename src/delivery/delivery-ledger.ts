// Delivery-evidence on the session-ledger (buildout F6 — the delivery store fold).
//
// Delivery-convention detection is a PROJECT-level snapshot (regenerated per
// machine from git history), not a per-conversation event, so it rides the #249
// session-ledger substrate under a project sentinel "session" rather than a real
// session id. Each detection run appends one `kind:detected` row to a single unit;
// the latest such row is the current detection.
//
// This is the evidence sink (decision D1 hard cutover): the dashboard reads the
// CURRENT detection from here, and the SIEM fold-view will union it. The legacy
// `.paqad/delivery-detection.json` file stays as the OPERATIONAL source the
// delivery-policy loader overlays and the documentation workflow reports — both
// are written together by `writeDetection`, so they never drift.

import { readLatestProjectEvent, recordProjectEvent } from '@/session-ledger/project-ledger.js';

import type { DetectedDelivery } from './detection.js';

export const DELIVERY_EVIDENCE_DOC_TYPE = 'delivery-evidence';
export const DELIVERY_EVIDENCE_SCHEMA_VERSION = 1;

/**
 * Append the detected delivery conventions as a `delivery-evidence` row. Appended
 * (not overwritten) so the ledger keeps the detection history; the latest row is
 * the current state. Best-effort — recording evidence must never break detection.
 */
export function recordDeliveryEvidence(projectRoot: string, detected: DetectedDelivery): void {
  recordProjectEvent(
    projectRoot,
    DELIVERY_EVIDENCE_DOC_TYPE,
    { kind: 'detected', detected },
    DELIVERY_EVIDENCE_SCHEMA_VERSION,
  );
}

/** The current detected delivery conventions from the ledger, or null when none. */
export function readLatestDeliveryEvidence(projectRoot: string): DetectedDelivery | null {
  const row = readLatestProjectEvent(
    projectRoot,
    DELIVERY_EVIDENCE_DOC_TYPE,
    (r) => r.kind === 'detected' && Boolean(r.detected),
  );
  return row ? (row.detected as DetectedDelivery) : null;
}
