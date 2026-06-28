// Bridge the flat `appendRagAudit` events into the structured rag-evidence ledger
// (issue #249 §5b, P2). The shared `.paqad/audit.log` is the framework-wide audit log
// (many subsystems write it), so we keep its flat line for backward compatibility and
// ALSO record a structured `paqad.rag-evidence` event for the RAG-specific ones — the
// structured ledger becomes the queryable source of truth without losing any event.
// Full retirement of the flat RAG lines (D3) is a documented follow-up.
//
// These are ENGINE-side events (build / sync / fallback), so they carry adapter
// "engine" — they are not tied to a specific provider seam.

import { recordRagEvidence } from './recorder.js';
import type { RagEvidenceFields } from './recorder.js';
import type { RagEvidenceKind, RagFallbackReason } from './types.js';

interface MappedEvent {
  kind: RagEvidenceKind;
  fields: RagEvidenceFields;
  ragEnabled: boolean;
}

function toInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Map an audit `reason` string to the closed `RagFallbackReason` enum. */
export function mapFallbackReason(reason: unknown): RagFallbackReason {
  const text = String(reason ?? '').toLowerCase();
  if (text.includes('disabled')) return 'rag-disabled';
  if (text.includes('provider') || text.includes('model')) return 'provider-mismatch';
  if (text.includes('chunker')) return 'chunker-mismatch';
  if (text.includes('below') || text.includes('floor')) return 'below-floor';
  if (text.includes('cold')) return 'cold';
  if (text.includes('missing-index') || text.includes('no-index') || text.includes('missing index'))
    return 'no-index';
  return 'error';
}

/**
 * Map a flat audit event to a structured rag-evidence event, or null when the event has
 * no rag-evidence equivalent (it stays in the flat log only).
 */
export function mapAuditEventToEvidence(
  event: string,
  fields: Record<string, unknown>,
): MappedEvent | null {
  switch (event) {
    case 'rag-build-completed':
      return {
        kind: 'refreshed',
        ragEnabled: true,
        fields: { refresh_kind: 'rebuild', chunks_embedded: toInt(fields.chunks) },
      };
    case 'rag-build-failed':
    case 'rag-build-cancelled':
      return {
        kind: 'fallback',
        ragEnabled: true,
        fields: { fallback_reason: 'error', note: event },
      };
    case 'rag-incremental-update':
      return {
        kind: 'refreshed',
        ragEnabled: true,
        fields: {
          refresh_kind: 'incremental-sync',
          changed_files: toInt(fields.changed_files),
          chunks_embedded: toInt(fields.chunks),
        },
      };
    case 'rag-vision-ingested':
      return { kind: 'refreshed', ragEnabled: true, fields: { refresh_kind: 'vision' } };
    case 'crs-reindexed':
      return { kind: 'refreshed', ragEnabled: true, fields: { refresh_kind: 'crs' } };
    case 'rag-fallback': {
      const reason = mapFallbackReason(fields.reason);
      return {
        kind: 'fallback',
        ragEnabled: reason !== 'rag-disabled',
        fields: { fallback_reason: reason },
      };
    }
    case 'rag-provider-mismatch':
      return {
        kind: 'fallback',
        ragEnabled: true,
        fields: { fallback_reason: 'provider-mismatch' },
      };
    case 'rag-rerank-fallback':
      return {
        kind: 'fallback',
        ragEnabled: true,
        fields: { fallback_reason: 'error', note: 'rerank' },
      };
    case 'rag-resume-warning':
      return {
        kind: 'fallback',
        ragEnabled: true,
        fields: { fallback_reason: 'error', note: 'resume-warning' },
      };
    case 'rag-api-key-validation-failed':
      return {
        kind: 'fallback',
        ragEnabled: true,
        fields: { fallback_reason: 'error', note: 'api-key' },
      };
    case 'rag-enabled':
      return { kind: 'open', ragEnabled: true, fields: {} };
    case 'rag-cleared':
      return { kind: 'close', ragEnabled: false, fields: {} };
    default:
      // rag-attachment-index-* and any other event: attachments are a refresh.
      if (event.startsWith('rag-attachment-index')) {
        return { kind: 'refreshed', ragEnabled: true, fields: { refresh_kind: 'attachment' } };
      }
      return null;
  }
}

/**
 * Record the structured rag-evidence equivalent of a flat audit event. Best-effort and
 * silent: an unmapped event or any recorder failure is a no-op (the flat line already
 * landed). Called from `appendRagAudit`.
 */
export function recordRagEvidenceFromAudit(
  projectRoot: string,
  event: string,
  fields: Record<string, unknown>,
): void {
  const mapped = mapAuditEventToEvidence(event, fields);
  if (!mapped) {
    return;
  }
  recordRagEvidence(projectRoot, mapped.kind, mapped.fields, {
    ragEnabled: mapped.ragEnabled,
    adapter: 'engine',
  });
}
