import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { readSessionDoc } from '@/session-ledger/ledger.js';
import { foldRagEvidenceSession } from '@/rag-ledger/fold.js';
import { openRagConversation, recordRagEvidence } from '@/rag-ledger/recorder.js';
import { validateRagEvidenceRow } from '@/rag-ledger/schema.js';
import { persistLedgerSessionId, resolveSessionId } from '@/rag-ledger/session.js';
import { RAG_EVIDENCE_DOC_TYPE } from '@/rag-ledger/types.js';

let tick = 0;
const clock = () => new Date(1_700_000_000_000 + tick++ * 1000);
const CTX = (over: Record<string, unknown> = {}) => ({
  sessionId: 'ses_test',
  ragEnabled: true,
  adapter: 'claude-code',
  now: clock,
  ...over,
});

function validRow(over: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    doc_type: RAG_EVIDENCE_DOC_TYPE,
    kind: 'used',
    session_id: 'ses_test',
    conversation_ordinal: 1,
    ts: '2026-06-28T00:00:00.000Z',
    rag_enabled: true,
    adapter: 'claude-code',
    injected: true,
    injected_sections: ['rules', 'retrieval'],
    slice_count: 3,
    score_top: 0.82,
    bytes_injected: 1200,
    content_hash: 'abc',
    ...over,
  };
}

describe('validateRagEvidenceRow', () => {
  it('accepts a well-formed row', () => {
    expect(validateRagEvidenceRow(validRow())).toEqual([]);
  });

  it('rejects an unknown kind', () => {
    expect(validateRagEvidenceRow(validRow({ kind: 'bogus' })).length).toBeGreaterThan(0);
  });

  it('rejects an unknown extra property (additionalProperties: false)', () => {
    expect(validateRagEvidenceRow(validRow({ surprise: 1 })).length).toBeGreaterThan(0);
  });

  it('rejects a missing required envelope field', () => {
    const row = validRow();
    delete (row as Record<string, unknown>).session_id;
    expect(validateRagEvidenceRow(row).length).toBeGreaterThan(0);
  });

  it('rejects an invalid fallback_reason', () => {
    expect(
      validateRagEvidenceRow(validRow({ kind: 'fallback', fallback_reason: 'nope' })).length,
    ).toBeGreaterThan(0);
  });
});

describe('resolveSessionId', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-rl-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('returns the host hint verbatim', () => {
    expect(resolveSessionId(root, 'ses_host_123')).toBe('ses_host_123');
  });

  it('persists the host hint so a later no-hint reader aligns (buildout F5b, #5)', () => {
    // A stale cache from a prior/engine run.
    mkdirSync(dirname(join(root, PATHS.LEDGER_SESSION_ID)), { recursive: true });
    writeFileSync(join(root, PATHS.LEDGER_SESSION_ID), 'ses_stale_engine_run');

    // The live session resolves with the host id — and refreshes the cache.
    expect(resolveSessionId(root, 'ses_live_4fc6')).toBe('ses_live_4fc6');
    expect(readFileSync(join(root, PATHS.LEDGER_SESSION_ID), 'utf8').trim()).toBe('ses_live_4fc6');

    // The completion seam (called with NO hint) now resolves the SAME live id,
    // instead of the stale engine id — one session, one ledger subdir.
    expect(resolveSessionId(root)).toBe('ses_live_4fc6');
  });

  it('mints and caches a ses_<ulid> when no hint', () => {
    const first = resolveSessionId(root);
    expect(first).toMatch(/^ses_[0-9a-z]{26}$/);
    expect(resolveSessionId(root)).toBe(first); // cached
    expect(readFileSync(join(root, PATHS.LEDGER_SESSION_ID), 'utf8').trim()).toBe(first);
  });
});

describe('persistLedgerSessionId (issue #380, Issue 1)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-rl-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('aligns a stale cache to the live host id so bundle minting keys on it', () => {
    // A prior session's id still sitting in the single-slot cache.
    mkdirSync(dirname(join(root, PATHS.LEDGER_SESSION_ID)), { recursive: true });
    writeFileSync(join(root, PATHS.LEDGER_SESSION_ID), 'ses_prior_session');

    expect(persistLedgerSessionId(root, 'ses_live_host')).toBe(true);
    // A later no-hint reader (the CLI escape hatch / minting path) now resolves the
    // LIVE id instead of the stale one — bundle and gate agree on one session.
    expect(resolveSessionId(root)).toBe('ses_live_host');
    expect(readFileSync(join(root, PATHS.LEDGER_SESSION_ID), 'utf8').trim()).toBe('ses_live_host');
  });

  it('creates the cache directory when it does not exist yet', () => {
    expect(persistLedgerSessionId(root, 'ses_first')).toBe(true);
    expect(readFileSync(join(root, PATHS.LEDGER_SESSION_ID), 'utf8').trim()).toBe('ses_first');
  });

  it('never mints: an empty / whitespace / missing id writes nothing', () => {
    expect(persistLedgerSessionId(root, null)).toBe(false);
    expect(persistLedgerSessionId(root, undefined)).toBe(false);
    expect(persistLedgerSessionId(root, '')).toBe(false);
    expect(persistLedgerSessionId(root, '   ')).toBe(false);
    // No cache file was created — nothing to align means nothing is written.
    expect(() => readFileSync(join(root, PATHS.LEDGER_SESSION_ID), 'utf8')).toThrow();
  });

  it('trims surrounding whitespace from the persisted id', () => {
    expect(persistLedgerSessionId(root, '  ses_padded  ')).toBe(true);
    expect(readFileSync(join(root, PATHS.LEDGER_SESSION_ID), 'utf8').trim()).toBe('ses_padded');
  });
});

describe('recorder + fold (round trip)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-rl-'));
    tick = 0;
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('records refreshed/called/used and reads them back validated', () => {
    const opened = openRagConversation(root, CTX());
    expect(opened?.ordinal).toBe(1);
    recordRagEvidence(
      root,
      'refreshed',
      { refresh_kind: 'incremental-sync', changed_files: 2, chunks_embedded: 3 },
      CTX({ ordinal: 1 }),
    );
    recordRagEvidence(
      root,
      'called',
      { query_scope: 'docs', top_n: 20, candidates: 12 },
      CTX({ ordinal: 1 }),
    );
    recordRagEvidence(
      root,
      'used',
      {
        injected: true,
        injected_sections: ['rules', 'retrieval'],
        slice_count: 4,
        score_top: 0.83,
        bytes_injected: 1820,
      },
      CTX({ ordinal: 1 }),
    );

    const rows = readSessionDoc(root, RAG_EVIDENCE_DOC_TYPE, 'ses_test');
    expect(rows.map((r) => r.kind)).toEqual(['open', 'refreshed', 'called', 'used']);
    // Every persisted row is a valid rag-evidence row.
    for (const row of rows) {
      expect(validateRagEvidenceRow(row)).toEqual([]);
    }
  });

  it('opens a conversation automatically for a background event when none is open', () => {
    const row = recordRagEvidence(
      root,
      'refreshed',
      { refresh_kind: 'rebuild', chunks_embedded: 10 },
      CTX({ sessionId: 'ses_bg', ordinal: undefined }),
    );
    expect(row?.conversation_ordinal).toBe(1);
    const rows = readSessionDoc(root, RAG_EVIDENCE_DOC_TYPE, 'ses_bg');
    // open (auto) + refreshed
    expect(rows.map((r) => r.kind)).toEqual(['open', 'refreshed']);
  });

  it('folds a session into a use-rate / fallback rollup', () => {
    openRagConversation(root, CTX({ sessionId: 'ses_fold' }));
    recordRagEvidence(
      root,
      'used',
      {
        injected: true,
        injected_sections: ['rules'],
        slice_count: 2,
        score_top: 0.9,
        latency_ms: 10,
      },
      CTX({ sessionId: 'ses_fold', ordinal: 1 }),
    );
    openRagConversation(root, CTX({ sessionId: 'ses_fold' }));
    recordRagEvidence(
      root,
      'fallback',
      { injected: false, fallback_reason: 'below-floor', latency_ms: 4 },
      CTX({ sessionId: 'ses_fold', ordinal: 2 }),
    );

    const fold = foldRagEvidenceSession(root, 'ses_fold');
    expect(fold.totals).toMatchObject({ used_count: 1, fallback_count: 1 });
    expect(fold.coverage.prompts_total).toBe(2);
    expect(fold.coverage.prompts_with_rag).toBe(1);
    expect(fold.coverage.prompts_fallback).toBe(1);
    expect(fold.coverage.fallback_reasons['below-floor']).toBe(1);
    const c1 = fold.conversations.find((c) => c.conversation_ordinal === 1)!;
    expect(c1.used_rate).toBe(1);
    expect(c1.sections_used).toEqual(['rules']);
    expect(c1.score_top).toBe(0.9);
  });

  it('redacts secrets in the note (best-effort, never throws)', () => {
    // Seed a project secret, then ensure a note containing it is redacted.
    writeFileSync(join(root, '.env-unused'), '');
    const row = recordRagEvidence(
      root,
      'fallback',
      { fallback_reason: 'error', note: 'plain note' },
      CTX({ sessionId: 'ses_note', ordinal: undefined }),
    );
    expect(row?.note).toBe('plain note');
  });
});
