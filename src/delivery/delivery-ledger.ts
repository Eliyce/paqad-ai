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

import {
  appendSessionEvent,
  currentOrdinal,
  openSessionDoc,
  readSessionDoc,
} from '@/session-ledger/ledger.js';

import type { DetectedDelivery } from './detection.js';

export const DELIVERY_EVIDENCE_DOC_TYPE = 'delivery-evidence';
export const DELIVERY_EVIDENCE_SCHEMA_VERSION = 1 as const;
/** Project sentinel — delivery detection is project-scoped, not session-scoped. */
const PROJECT_SESSION = '_project';

/** The session's single delivery-evidence unit, opening it on first record. */
function ensureUnit(projectRoot: string): number {
  const current = currentOrdinal(projectRoot, DELIVERY_EVIDENCE_DOC_TYPE, PROJECT_SESSION);
  if (current > 0) {
    return current;
  }
  return openSessionDoc(projectRoot, DELIVERY_EVIDENCE_DOC_TYPE, PROJECT_SESSION, {}).ordinal;
}

/**
 * Append the detected delivery conventions as a `delivery-evidence` row. Appended
 * (not overwritten) so the ledger keeps the detection history; the latest row is
 * the current state. Best-effort — recording evidence must never break detection.
 */
export function recordDeliveryEvidence(projectRoot: string, detected: DetectedDelivery): void {
  try {
    const ordinal = ensureUnit(projectRoot);
    appendSessionEvent(
      projectRoot,
      DELIVERY_EVIDENCE_DOC_TYPE,
      PROJECT_SESSION,
      ordinal,
      { kind: 'detected', detected },
      { schemaVersion: DELIVERY_EVIDENCE_SCHEMA_VERSION },
    );
  } catch {
    // Best-effort evidence write; detection itself is unaffected.
  }
}

/** The current detected delivery conventions from the ledger, or null when none. */
export function readLatestDeliveryEvidence(projectRoot: string): DetectedDelivery | null {
  const rows = readSessionDoc(projectRoot, DELIVERY_EVIDENCE_DOC_TYPE, PROJECT_SESSION);
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row.kind === 'detected' && row.detected) {
      return row.detected as DetectedDelivery;
    }
  }
  return null;
}
