import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DECISION_REUSE_DOC_TYPE,
  recordDecisionReuse,
  validateDecisionReuseRow,
} from '@/decision-reuse/index.js';
import { readSessionDoc, sessionLedgerDir } from '@/session-ledger/ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

describe('decision-reuse ledger', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dreuse-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function reuseRows(sessionId: string) {
    return readSessionDoc(root, DECISION_REUSE_DOC_TYPE, sessionId).filter(
      (row) => row.kind === 'reuse',
    );
  }

  it('records a reuse row for an approved decision', () => {
    const row = recordDecisionReuse(
      root,
      {
        decisionId: 'D-abc',
        category: 'component-reuse',
        chosenOptionKey: 'reuse-button',
        matchKind: 'exact',
        sourcePath: '.paqad/decisions/resolved/D-abc.json',
      },
      { sessionId: 'ses_a', adapter: 'claude-code' },
    );
    expect(row).not.toBeNull();
    expect(row?.kind).toBe('reuse');
    expect(row?.decision_id).toBe('D-abc');
    expect(row?.match_kind).toBe('exact');
    expect(validateDecisionReuseRow(row)).toEqual([]);
  });

  it('keeps many reuses of one session in a single unit (one session, many reuses)', () => {
    const ctx = { sessionId: 'ses_many', adapter: 'claude-code' };
    recordDecisionReuse(root, { decisionId: 'D-1', matchKind: 'exact' }, ctx);
    recordDecisionReuse(root, { decisionId: 'D-2', matchKind: 'fingerprint' }, ctx);
    recordDecisionReuse(root, { decisionId: 'D-3', matchKind: 'exact' }, ctx);

    const rows = reuseRows('ses_many');
    expect(rows.map((row) => row.decision_id)).toEqual(['D-1', 'D-2', 'D-3']);
    // All in ordinal 1 (one unit per session).
    const dir = join(root, sessionLedgerDir(DECISION_REUSE_DOC_TYPE, 'ses_many'));
    expect(existsSync(join(dir, '1.jsonl'))).toBe(true);
    expect(existsSync(join(dir, '2.jsonl'))).toBe(false);
  });

  it('persists under .paqad/ledger/paqad.decision-reuse/<session>/ (git-ignored root)', () => {
    recordDecisionReuse(root, { decisionId: 'D-x', matchKind: 'exact' }, { sessionId: 'ses_p' });
    const dir = join(root, '.paqad/ledger', DECISION_REUSE_DOC_TYPE, 'ses_p');
    expect(existsSync(join(dir, '1.jsonl'))).toBe(true);
  });

  it('mints and caches a session id when the host supplies none', () => {
    const row = recordDecisionReuse(root, { decisionId: 'D-mint', matchKind: 'exact' }, {});
    expect(row).not.toBeNull();
    // The same minted id is reused for the whole machine-local session.
    const sessionId = resolveSessionId(root);
    expect(reuseRows(sessionId).map((r) => r.decision_id)).toContain('D-mint');
  });

  it('defaults adapter to "unknown" when the caller has none', () => {
    const row = recordDecisionReuse(
      root,
      { decisionId: 'D-na', matchKind: 'exact' },
      { sessionId: 'ses_na' },
    );
    expect(row?.adapter).toBe('unknown');
  });

  it('nulls every absent optional field, and keeps a supplied note', () => {
    const bare = recordDecisionReuse(
      root,
      { decisionId: 'D-bare', matchKind: 'exact' },
      {
        sessionId: 'ses_bare',
      },
    );
    expect(bare?.category).toBeNull();
    expect(bare?.chosen_option_key).toBeNull();
    expect(bare?.source_path).toBeNull();
    expect(bare?.note).toBeNull();

    const full = recordDecisionReuse(
      root,
      {
        decisionId: 'D-full',
        category: 'architecture-path',
        chosenOptionKey: 'option-b',
        matchKind: 'fingerprint',
        sourcePath: '.paqad/decisions/resolved/D-full.json',
        note: 'reused from a near-identical prior',
      },
      { sessionId: 'ses_bare' },
    );
    expect(full?.note).toBe('reused from a near-identical prior');
    expect(full?.match_kind).toBe('fingerprint');
  });
});
