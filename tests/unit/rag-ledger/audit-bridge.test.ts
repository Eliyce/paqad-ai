import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { appendRagAudit } from '@/rag/audit.js';
import { mapAuditEventToEvidence, mapFallbackReason } from '@/rag-ledger/audit-bridge.js';
import { foldRagEvidenceSession } from '@/rag-ledger/fold.js';
import { validateRagEvidenceRow } from '@/rag-ledger/schema.js';
import { readSessionDoc } from '@/session-ledger/ledger.js';
import { RAG_EVIDENCE_DOC_TYPE } from '@/rag-ledger/types.js';

describe('mapFallbackReason', () => {
  it('maps known reason substrings to the closed enum', () => {
    expect(mapFallbackReason('missing-index-during-refresh')).toBe('no-index');
    expect(mapFallbackReason('configured provider/model does not match')).toBe('provider-mismatch');
    expect(mapFallbackReason('built with a different chunker')).toBe('chunker-mismatch');
    expect(mapFallbackReason('below the similarity floor')).toBe('below-floor');
    expect(mapFallbackReason('rag disabled')).toBe('rag-disabled');
    expect(mapFallbackReason('something weird')).toBe('error');
  });
});

describe('mapAuditEventToEvidence', () => {
  it('maps refresh-family events to refreshed', () => {
    expect(mapAuditEventToEvidence('rag-build-completed', { chunks: 12 })).toMatchObject({
      kind: 'refreshed',
      fields: { refresh_kind: 'rebuild', chunks_embedded: 12 },
    });
    expect(
      mapAuditEventToEvidence('rag-incremental-update', { changed_files: 2, chunks: 5 }),
    ).toMatchObject({
      kind: 'refreshed',
      fields: { refresh_kind: 'incremental-sync', changed_files: 2, chunks_embedded: 5 },
    });
    expect(mapAuditEventToEvidence('rag-attachment-index-built', {})?.kind).toBe('refreshed');
  });

  it('maps fallback-family events to fallback', () => {
    expect(mapAuditEventToEvidence('rag-fallback', { reason: 'missing-index' })).toMatchObject({
      kind: 'fallback',
      fields: { fallback_reason: 'no-index' },
    });
    expect(mapAuditEventToEvidence('rag-rerank-fallback', {})).toMatchObject({
      kind: 'fallback',
      fields: { fallback_reason: 'error', note: 'rerank' },
    });
  });

  it('returns null for an unmapped event', () => {
    expect(mapAuditEventToEvidence('some-unrelated-event', {})).toBeNull();
  });
});

describe('appendRagAudit dual-write (#249 P2)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-ab-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('keeps the flat audit.log line AND records a structured rag-evidence row', () => {
    appendRagAudit(root, 'INFO', 'rag-incremental-update', { changed_files: 1, chunks: 3 });

    // Flat log unchanged (other subsystems still read it).
    const flat = readFileSync(join(root, PATHS.AUDIT_LOG), 'utf8');
    expect(flat).toContain('rag-incremental-update');

    // Structured ledger now carries the event (read via the substrate reader).
    const sessions = readSessionDoc(root, RAG_EVIDENCE_DOC_TYPE, readSessionId(root));
    const refreshed = sessions.find((r) => r.kind === 'refreshed');
    expect(refreshed).toMatchObject({ refresh_kind: 'incremental-sync', changed_files: 1 });
    for (const row of sessions) {
      expect(validateRagEvidenceRow(row)).toEqual([]);
    }
  });

  it('folds dual-written fallback events into the rollup', () => {
    appendRagAudit(root, 'WARN', 'rag-fallback', { reason: 'missing-index' });
    const fold = foldRagEvidenceSession(root, readSessionId(root));
    expect(fold.totals.fallback_count).toBe(1);
    expect(fold.coverage.fallback_reasons['no-index']).toBe(1);
  });
});

/** The ledger session id minted by the recorder (cached under .paqad/session). */
function readSessionId(root: string): string {
  expect(existsSync(join(root, PATHS.LEDGER_SESSION_ID))).toBe(true);
  return readFileSync(join(root, PATHS.LEDGER_SESSION_ID), 'utf8').trim();
}
