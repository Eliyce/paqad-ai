import { readLatestProjectEvent, recordProjectEvent } from '@/session-ledger/project-ledger.js';

import type { DetectedDelivery } from './detection.js';

export const DELIVERY_EVIDENCE_DOC_TYPE = 'delivery-evidence';
export const DELIVERY_EVIDENCE_SCHEMA_VERSION = 1;

export function recordDeliveryEvidence(projectRoot: string, detected: DetectedDelivery): void {
  recordProjectEvent(
    projectRoot,
    DELIVERY_EVIDENCE_DOC_TYPE,
    { kind: 'detected', detected },
    DELIVERY_EVIDENCE_SCHEMA_VERSION,
  );
}

export function readLatestDeliveryEvidence(projectRoot: string): DetectedDelivery | null {
  const row = readLatestProjectEvent(
    projectRoot,
    DELIVERY_EVIDENCE_DOC_TYPE,
    (r) => r.kind === 'detected' && Boolean(r.detected),
  );
  return row ? (row.detected as DetectedDelivery) : null;
}
