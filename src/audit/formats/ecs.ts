// Issue #121 — Elastic Common Schema (ECS) projection.
//
// Trivial given the #118 fields: `@timestamp`, `event.action` ← code,
// `event.outcome` ← verdict, `event.id` ← content_hash (the dedup key), the
// changed-file digests under `file`/`related.hash`, and the accepting human
// under `user`. paqad-specific grading rides in `labels.*` (ECS keyword values,
// so everything is stringified).

import { ecsOutcome, eventMessage, ocsfSeverityId } from '../severity.js';
import type { SiemEvent } from '../types.js';

/** Pinned ECS version the records target. */
export const ECS_VERSION = '8.11.0';

function labels(event: SiemEvent): Record<string, string> {
  return {
    paqad_kind: event.kind,
    ...(event.engine !== undefined ? { paqad_engine: event.engine } : {}),
    paqad_verdict: event.verdict,
    ...(event.strength_class !== undefined ? { paqad_strength_class: event.strength_class } : {}),
    ...(event.subject_digest !== undefined ? { paqad_subject_digest: event.subject_digest } : {}),
    ...(event.signing_mode !== undefined ? { paqad_signing_mode: event.signing_mode } : {}),
    ...(event.sealed !== undefined ? { paqad_sealed: String(event.sealed) } : {}),
    ...(event.receipt_hash !== undefined ? { paqad_receipt_hash: event.receipt_hash } : {}),
  };
}

/** Build the ECS document (a plain object; the orchestrator serializes it). */
export function toEcsRecord(event: SiemEvent, productVersion: string): Record<string, unknown> {
  const record: Record<string, unknown> = {
    '@timestamp': event.ts,
    ecs: { version: ECS_VERSION },
    event: {
      kind: 'event',
      category: ['configuration'],
      type: ['info'],
      action: event.code,
      outcome: ecsOutcome(event.verdict),
      module: 'paqad',
      dataset: 'paqad.evidence',
      provider: 'paqad-ai',
      severity: ocsfSeverityId(event.verdict),
      ...(event.content_hash !== undefined ? { id: event.content_hash } : {}),
      ...(event.detail !== undefined ? { reason: event.detail } : {}),
    },
    observer: { product: 'paqad-ai', vendor: 'Paqad', version: productVersion },
    message: eventMessage(event),
    tags: ['paqad', event.kind],
    labels: labels(event),
  };

  const subjects = event.subjects ?? [];
  if (subjects.length > 0) {
    record.related = { hash: subjects.map((subject) => subject.sha256) };
    // ECS `file` is a single object — populate it only when there is exactly one
    // changed file, otherwise the per-file digests live in `related.hash`.
    if (subjects.length === 1) {
      record.file = {
        name: subjects[0].name,
        hash: { sha256: subjects[0].sha256 },
      };
    }
  }

  const human = event.authorship?.accepting_human;
  if (human !== undefined && (human.name !== undefined || human.email !== undefined)) {
    record.user = {
      ...(human.name !== undefined ? { name: human.name } : {}),
      ...(human.email !== undefined ? { email: human.email } : {}),
    };
  }

  return record;
}

/** One ECS document, serialized as a single JSON line. */
export function toEcs(event: SiemEvent, productVersion: string): string {
  return JSON.stringify(toEcsRecord(event, productVersion));
}
