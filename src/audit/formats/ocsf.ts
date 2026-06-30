// Issue #121 — OCSF (Open Cybersecurity Schema Framework) projection.
//
// OCSF is the vendor-neutral lingua franca Splunk, Elastic, Datadog, AWS
// Security Lake, and Microsoft Sentinel all ingest. We map each event to the
// Application Activity class (uid 6003) with correct base attributes, and carry
// paqad's graded-evidence fields — which core OCSF has no slot for — under the
// `unmapped` extension. Honest, in the spirit of #118's "CycloneDX-adjacent"
// AI-BOM: the format is honoured; the correctness fields are a faithful addition.

import { epochMs, eventMessage, ocsfSeverityId, ocsfStatusId } from '../severity.js';
import type { SiemEvent } from '../types.js';

/** Pinned OCSF schema version the records target. */
export const OCSF_SCHEMA_VERSION = '1.3.0';

const CLASS_UID = 6003; // Application Activity
const CATEGORY_UID = 6; // Application Activity
const ACTIVITY_ID = 0; // Unknown — paqad events don't map to a CRUD-style verb.

function statusLabel(statusId: number): string {
  if (statusId === 1) return 'Success';
  if (statusId === 2) return 'Failure';
  return 'Unknown';
}

/** OCSF `activity_name` for a paqad event kind. */
function activityName(kind: SiemEvent['kind']): string {
  switch (kind) {
    case 'attestation':
      return 'Attestation';
    case 'session':
      return 'Session';
    default:
      return 'Evidence';
  }
}

/** Build the OCSF record (a plain object; the orchestrator serializes it). */
export function toOcsfRecord(event: SiemEvent, productVersion: string): Record<string, unknown> {
  const statusId = ocsfStatusId(event.verdict);

  const paqad: Record<string, unknown> = {
    kind: event.kind,
    code: event.code,
    verdict: event.verdict,
    ...(event.doc_type !== undefined ? { doc_type: event.doc_type } : {}),
    ...(event.session_id !== undefined ? { session_id: event.session_id } : {}),
    ...(event.detail !== undefined ? { detail: event.detail } : {}),
    ...(event.engine !== undefined ? { engine: event.engine } : {}),
    ...(event.subject_digest !== undefined ? { subject_digest: event.subject_digest } : {}),
    ...(event.strength_class !== undefined ? { strength_class: event.strength_class } : {}),
    ...(event.content_hash !== undefined ? { content_hash: event.content_hash } : {}),
    ...(event.sealed !== undefined ? { sealed: event.sealed } : {}),
    ...(event.signing_mode !== undefined ? { signing_mode: event.signing_mode } : {}),
    ...(event.receipt_hash !== undefined ? { receipt_hash: event.receipt_hash } : {}),
    ...(event.prev_receipt_hash !== undefined
      ? { prev_receipt_hash: event.prev_receipt_hash }
      : {}),
    ...(event.authorship !== undefined ? { authorship: event.authorship } : {}),
  };

  const record: Record<string, unknown> = {
    activity_id: ACTIVITY_ID,
    activity_name: activityName(event.kind),
    category_uid: CATEGORY_UID,
    category_name: 'Application Activity',
    class_uid: CLASS_UID,
    class_name: 'Application Activity',
    type_uid: CLASS_UID * 100 + ACTIVITY_ID,
    time: epochMs(event.ts),
    severity_id: ocsfSeverityId(event.verdict),
    status_id: statusId,
    status: statusLabel(statusId),
    message: eventMessage(event),
    metadata: {
      version: OCSF_SCHEMA_VERSION,
      product: { name: 'paqad-ai', vendor_name: 'Paqad', version: productVersion },
      log_name: 'evidence-ledger',
      log_provider: 'paqad-ai',
      ...(event.content_hash !== undefined ? { uid: event.content_hash } : {}),
    },
    unmapped: { paqad },
  };

  if (event.authorship !== undefined) {
    const human = event.authorship.accepting_human;
    record.actor = {
      ...(event.authorship.agent !== undefined ? { app_name: event.authorship.agent } : {}),
      ...(human !== undefined
        ? {
            user: {
              ...(human.name !== undefined ? { name: human.name } : {}),
              ...(human.email !== undefined ? { email_addr: human.email } : {}),
            },
          }
        : {}),
    };
  }

  if (event.subjects !== undefined && event.subjects.length > 0) {
    record.observables = event.subjects.map((subject) => ({
      name: subject.name,
      type: 'File Hash',
      value: subject.sha256,
    }));
  }

  return record;
}

/** One OCSF record, serialized as a single JSON line. */
export function toOcsf(event: SiemEvent, productVersion: string): string {
  return JSON.stringify(toOcsfRecord(event, productVersion));
}
