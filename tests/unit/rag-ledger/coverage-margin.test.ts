import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mapAuditEventToEvidence, mapFallbackReason } from '@/rag-ledger/audit-bridge.js';
import { foldRagEvidenceRows } from '@/rag-ledger/fold.js';
import { recordRagEvidence } from '@/rag-ledger/recorder.js';
import { foldByOrdinal, type SessionLedgerRow } from '@/session-ledger/ledger.js';

describe('audit-bridge edge mappings', () => {
  it('maps the cold and model-mismatch and build-failed cases', () => {
    expect(mapFallbackReason('index is cold')).toBe('cold');
    expect(mapFallbackReason('embedding model changed')).toBe('provider-mismatch');
    expect(mapAuditEventToEvidence('rag-build-failed', {})).toMatchObject({
      kind: 'fallback',
      fields: { fallback_reason: 'error', note: 'rag-build-failed' },
    });
    expect(mapAuditEventToEvidence('rag-enabled', {})?.kind).toBe('open');
    expect(mapAuditEventToEvidence('rag-cleared', {})?.kind).toBe('close');
  });

  it('coerces a non-numeric count to null', () => {
    expect(mapAuditEventToEvidence('rag-build-completed', { chunks: 'NaN' })).toMatchObject({
      fields: { chunks_embedded: null },
    });
  });
});

describe('fold edge cases', () => {
  it('reports null rates/latency/score for a conversation with no used or fallback', () => {
    const rows = [
      { conversation_ordinal: 1, kind: 'open' },
      { conversation_ordinal: 1, kind: 'refreshed' },
    ] as unknown as SessionLedgerRow[];
    const fold = foldRagEvidenceRows('ses_empty', rows);
    const c1 = fold.conversations[0];
    expect(c1.used_rate).toBeNull();
    expect(c1.avg_latency_ms).toBeNull();
    expect(c1.score_top).toBeNull();
    expect(fold.coverage.prompts_with_rag).toBe(0);
  });

  it('foldByOrdinal buckets rows missing an ordinal under 0', () => {
    const folded = foldByOrdinal([{ kind: 'x' } as unknown as SessionLedgerRow]);
    expect([...folded.keys()]).toEqual([0]);
  });
});

describe('recorder failure path', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-rec-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('returns null (best-effort) when a row fails schema validation', () => {
    // An invalid query_scope makes the AJV validator reject → recorder swallows → null.
    const row = recordRagEvidence(
      root,
      'called',
      { query_scope: 'bogus' as unknown as 'docs' },
      { sessionId: 'ses_bad', adapter: 'engine', ragEnabled: true, ordinal: 1 },
    );
    expect(row).toBeNull();
  });
});
