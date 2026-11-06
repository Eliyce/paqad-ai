import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DECISION_REUSE_DOC_TYPE,
  recordDecisionReuse,
  recordSuggestionOutcome,
  type DecisionReuseFields,
  validateDecisionReuseRow,
} from '@/decision-reuse/index.js';
import { decisionsReceiptLine } from '@/decision-reuse/receipt-line.js';
import { seedFeatureRecord } from '@/feature-evidence/feature-record.js';
import { featureChangeKey } from '@/feature-evidence/paths.js';
import { composeChangeReceipt } from '@/verification/repository/receipt.js';
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

describe('AC-16 AC-27 the decisions line on the receipt', () => {
  const SESSION = 'ses_receipt';
  const DIR = 'one-click-01JABCDEFGHJKMNPQRSTVWXYZ0';
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dreuse-line-'));
    seedFeatureRecord(root, DIR, { adapter: 'claude-code', sessionId: SESSION });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const ctx = { sessionId: SESSION, now: () => new Date('2999-01-01T00:00:00.000Z') };
  const change = featureChangeKey(DIR);
  const add = (fields: Partial<DecisionReuseFields>, context = ctx): void => {
    recordDecisionReuse(root, { decisionId: 'D-1', ...fields }, context);
  };

  it('AC-16 carries the right counts, and there is no line with no rows', () => {
    expect(decisionsReceiptLine(root, DIR)).toBeNull();
    add({ kind: 'suggestion', matchKind: 'intent', outcome: 'accepted', change });
    add({ kind: 'suggestion', matchKind: 'intent', outcome: 'accepted', change });
    add({ kind: 'suggestion', matchKind: 'intent', outcome: 'changed', change });
    add({ kind: 'reuse', matchKind: 'standing', change });
    const line = decisionsReceiptLine(root, DIR, SESSION);
    expect(line).toBe(
      'decisions: 3 earlier answers suggested, 2 accepted, 1 changed; 1 standing answer used',
    );
    const receipt = composeChangeReceipt({ verdictSummary: 'ok', fold: null, decisions: line });
    expect(receipt).toContain(`> ${line}`);
    expect(composeChangeReceipt({ verdictSummary: 'ok', fold: null })).toBe('ok');
  });

  it('AC-27 excludes another change, keeps none out of suggested and ignores similar and exact', () => {
    add({ kind: 'suggestion', outcome: 'accepted', change });
    add({ kind: 'suggestion', outcome: 'none', change });
    add({ kind: 'suggestion', outcome: 'accepted', change: 'other-change' });
    add({ kind: 'reuse', matchKind: 'standing', change: 'other-change' });
    add({ kind: 'reuse', matchKind: 'similar', change });
    add({ kind: 'reuse', matchKind: 'exact', change });
    add({ kind: 'standing-set', change });
    expect(decisionsReceiptLine(root, DIR)).toBe(
      'decisions: 1 earlier answer suggested, 1 accepted, 0 changed; 1 checked, none fit',
    );
  });

  it('AC-27 a change with only none rows still gets a line, and plural standing answers read well', () => {
    add({ kind: 'suggestion', outcome: 'none', change });
    expect(decisionsReceiptLine(root, DIR)).toBe('decisions: 1 checked, none fit');
    add({ kind: 'reuse', matchKind: 'standing', change });
    add({ kind: 'reuse', matchKind: 'standing', change });
    expect(decisionsReceiptLine(root, DIR)).toBe(
      'decisions: 1 checked, none fit; 2 standing answers used',
    );
  });

  it('counts a row with no change only by session and start time', () => {
    add({ kind: 'suggestion', outcome: 'accepted' });
    add(
      { kind: 'suggestion', outcome: 'changed' },
      {
        sessionId: SESSION,
        now: () => new Date('2000-01-01T00:00:00.000Z'),
      },
    );
    expect(decisionsReceiptLine(root, DIR)).toBe(
      'decisions: 1 earlier answer suggested, 1 accepted, 0 changed',
    );
  });

  it('reads rows from the receipt session as well, and needs a feature record', () => {
    add({ kind: 'suggestion', outcome: 'accepted', change }, { ...ctx, sessionId: 'ses_other' });
    expect(decisionsReceiptLine(root, DIR)).toBeNull();
    expect(decisionsReceiptLine(root, DIR, 'ses_other')).toContain('1 accepted');
    expect(decisionsReceiptLine(root, 'gone-01JABCDEFGHJKMNPQRSTVWXYZ1')).toBeNull();
  });

  it('keeps every new row shape valid against the schema', () => {
    const rows = readSessionDoc(root, DECISION_REUSE_DOC_TYPE, SESSION);
    expect(rows).toEqual([]);
    add({
      kind: 'suggestion',
      decisionId: null,
      outcome: 'none',
      forDecision: 'D-2',
      ruleId: 'R-1',
    });
    const written = readSessionDoc(root, DECISION_REUSE_DOC_TYPE, SESSION).at(-1)!;
    expect(validateDecisionReuseRow(written)).toEqual([]);
    expect(recordSuggestionOutcome(root, { forDecision: 'D-3', chosen: 'a' }, ctx)).toBeNull();
  });
});
