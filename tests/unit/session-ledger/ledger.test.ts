import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  allocateOrdinal,
  appendSessionEvent,
  computeSessionRowHash,
  currentOrdinal,
  foldByOrdinal,
  openSessionDoc,
  readSessionDoc,
  readSessionUnit,
  sessionLedgerPath,
  sessionOpenPointerPath,
  type SessionLedgerRow,
} from '@/session-ledger/ledger.js';

const DOC = 'paqad.test-doc';
const SESSION = 'ses_abc';
let now = 0;
const clock = () => new Date(1_700_000_000_000 + now++ * 1000);

describe('session-ledger substrate (#249 P0)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-sl-'));
    now = 0;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lays files out under .paqad/ledger/<docType>/<session>/<ordinal>.jsonl', () => {
    expect(sessionLedgerPath(DOC, SESSION, 3)).toBe(
      join(PATHS.EVIDENCE_LEDGER_DIR, DOC, SESSION, '3.jsonl'),
    );
  });

  it('allocates monotonic ordinals and tracks the .open pointer', () => {
    expect(allocateOrdinal(root, DOC, SESSION)).toBe(1);
    expect(currentOrdinal(root, DOC, SESSION)).toBe(1);
    expect(allocateOrdinal(root, DOC, SESSION)).toBe(2);
    expect(allocateOrdinal(root, DOC, SESSION)).toBe(3);
    expect(currentOrdinal(root, DOC, SESSION)).toBe(3);
  });

  it('currentOrdinal is 0 before anything is allocated', () => {
    expect(currentOrdinal(root, DOC, SESSION)).toBe(0);
  });

  it('openSessionDoc writes a kind:open row with a script-clock ts and content hash', () => {
    const { ordinal } = openSessionDoc(root, DOC, SESSION, { rag_enabled: true }, { now: clock });
    expect(ordinal).toBe(1);
    const rows = readSessionUnit(root, DOC, SESSION, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      doc_type: DOC,
      session_id: SESSION,
      kind: 'open',
      conversation_ordinal: 1,
      rag_enabled: true,
      schema_version: 1,
    });
    expect(rows[0].ts).toBe(new Date(1_700_000_000_000).toISOString());
    expect(typeof rows[0].content_hash).toBe('string');
  });

  it('appendSessionEvent stamps the envelope and appends JSONL lines', () => {
    const ordinal = allocateOrdinal(root, DOC, SESSION);
    appendSessionEvent(
      root,
      DOC,
      SESSION,
      ordinal,
      { kind: 'called', conversation_ordinal: ordinal, top_n: 5 },
      { now: clock },
    );
    appendSessionEvent(
      root,
      DOC,
      SESSION,
      ordinal,
      { kind: 'used', conversation_ordinal: ordinal, injected: true },
      { now: clock },
    );
    const rows = readSessionUnit(root, DOC, SESSION, ordinal);
    expect(rows.map((r) => r.kind)).toEqual(['called', 'used']);
    expect(rows[0]).toMatchObject({ top_n: 5, doc_type: DOC });
  });

  it('the content hash excludes ts/content_hash/note but covers identity fields', () => {
    const a = computeSessionRowHash({ kind: 'used', injected: true, ts: 't1', note: 'x' });
    const b = computeSessionRowHash({ kind: 'used', injected: true, ts: 't2', note: 'y' });
    const c = computeSessionRowHash({ kind: 'used', injected: false, ts: 't1', note: 'x' });
    expect(a).toBe(b); // ts/note do not change identity
    expect(a).not.toBe(c); // injected does
  });

  it('runs the injected validator and throws on rejection', () => {
    const ordinal = allocateOrdinal(root, DOC, SESSION);
    const validate = (row: SessionLedgerRow) => (row.kind === 'bad' ? ['kind is bad'] : []);
    expect(() =>
      appendSessionEvent(root, DOC, SESSION, ordinal, { kind: 'bad' }, { validate, now: clock }),
    ).toThrow(/kind is bad/);
    expect(() =>
      appendSessionEvent(root, DOC, SESSION, ordinal, { kind: 'ok' }, { validate, now: clock }),
    ).not.toThrow();
  });

  it('reads every unit of a session ordinal-ascending and folds by ordinal', () => {
    const o1 = openSessionDoc(root, DOC, SESSION, {}, { now: clock }).ordinal;
    appendSessionEvent(
      root,
      DOC,
      SESSION,
      o1,
      { kind: 'used', conversation_ordinal: o1 },
      { now: clock },
    );
    const o2 = openSessionDoc(root, DOC, SESSION, {}, { now: clock }).ordinal;
    appendSessionEvent(
      root,
      DOC,
      SESSION,
      o2,
      { kind: 'fallback', conversation_ordinal: o2 },
      { now: clock },
    );

    const all = readSessionDoc(root, DOC, SESSION);
    expect(all.map((r) => r.conversation_ordinal)).toEqual([1, 1, 2, 2]);

    const folded = foldByOrdinal(all);
    expect([...folded.keys()]).toEqual([1, 2]);
    expect(folded.get(1)!.map((r) => r.kind)).toEqual(['open', 'used']);
    expect(folded.get(2)!.map((r) => r.kind)).toEqual(['open', 'fallback']);
  });

  it('tolerates a corrupt line without poisoning the read', () => {
    const ordinal = allocateOrdinal(root, DOC, SESSION);
    appendSessionEvent(
      root,
      DOC,
      SESSION,
      ordinal,
      { kind: 'used', conversation_ordinal: ordinal },
      { now: clock },
    );
    // Append a junk line directly after a valid one.
    appendFileSync(join(root, sessionLedgerPath(DOC, SESSION, ordinal)), 'not json{\n', 'utf8');
    const rows = readSessionUnit(root, DOC, SESSION, ordinal);
    expect(rows).toHaveLength(1);
  });

  it('returns [] for an unknown session', () => {
    expect(readSessionDoc(root, DOC, 'ses_missing')).toEqual([]);
    expect(readSessionUnit(root, DOC, 'ses_missing', 1)).toEqual([]);
    expect(existsSync(join(root, sessionLedgerPath(DOC, 'ses_missing', 1)))).toBe(false);
  });

  it('currentOrdinal is 0 when the .open pointer is non-integer', () => {
    allocateOrdinal(root, DOC, SESSION);
    writeFileSync(join(root, sessionOpenPointerPath(DOC, SESSION)), 'not-a-number', 'utf8');
    expect(currentOrdinal(root, DOC, SESSION)).toBe(0);
  });

  it('drops a JSON line that is not a ledger row (e.g. a bare value)', () => {
    const ordinal = allocateOrdinal(root, DOC, SESSION);
    appendSessionEvent(
      root,
      DOC,
      SESSION,
      ordinal,
      { kind: 'used', conversation_ordinal: ordinal },
      { now: clock },
    );
    appendFileSync(join(root, sessionLedgerPath(DOC, SESSION, ordinal)), '42\n', 'utf8');
    expect(readSessionUnit(root, DOC, SESSION, ordinal)).toHaveLength(1);
  });
});
