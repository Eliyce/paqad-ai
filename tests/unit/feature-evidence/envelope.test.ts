import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  AI_BOM_HEADER_PREFIX,
  buildDocumentEnvelope,
  buildEnvelopeHeader,
  buildTextHeader,
  docRecordedAt,
  ENVELOPE_HEADER_KEYS,
  fromAiBomProperties,
  normalizeDocType,
  readEnvelope,
  readHeaderScript,
  renderFrontMatter,
  renderHeaderScript,
  rowRecordedAt,
  splitFrontMatter,
  stampBundleRow,
  toAiBomProperties,
  withReceiptHeader,
} from '@/feature-evidence/envelope.js';
import { computeContentHash } from '@/feature-evidence/mint.js';
import {
  ENVELOPE_HEADER_PROPERTIES,
  ENVELOPE_SCHEMA_FRAGMENT,
  validateEnvelopeHeader,
} from '@/feature-evidence/schema.js';
import { computeSessionRowHash } from '@/session-ledger/ledger.js';

import Ajv from 'ajv';

const CHANGE = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const SESSION = 'session-1';
const T1 = () => new Date('2026-09-25T10:00:00.000Z');
const T2 = () => new Date('2026-09-26T11:30:00.000Z');

const identity = {
  docType: 'paqad.plan',
  change: CHANGE,
  sessionId: SESSION,
  schemaVersion: 2,
};

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

describe('buildDocumentEnvelope', () => {
  it('puts the six header fields first, in fixed order, then the body', () => {
    const doc = buildDocumentEnvelope({ ...identity, body: { summary: 's', steps: [] }, now: T1 });
    expect(Object.keys(doc)).toEqual([...ENVELOPE_HEADER_KEYS, 'summary', 'steps']);
    expect(doc).toMatchObject({
      schema_version: 2,
      doc_type: 'paqad.plan',
      change: CHANGE,
      session_id: SESSION,
      recorded_at: '2026-09-25T10:00:00.000Z',
      summary: 's',
    });
    expect(validateEnvelopeHeader(doc)).toEqual([]);
  });

  it('hashes with computeContentHash over identity + body, so the hash is time-free', () => {
    const first = buildDocumentEnvelope({ ...identity, body: { summary: 's' }, now: T1 });
    const later = buildDocumentEnvelope({ ...identity, body: { summary: 's' }, now: T2 });
    expect(first.content_hash).toBe(later.content_hash);
    // Re-hashing the stored document (recorded_at and content_hash included) gives the same hash.
    expect(computeContentHash(first)).toBe(first.content_hash);
    const edited = buildDocumentEnvelope({ ...identity, body: { summary: 't' }, now: T1 });
    expect(edited.content_hash).not.toBe(first.content_hash);
  });

  it('uses the real clock when no seam is given', () => {
    const doc = buildDocumentEnvelope({ ...identity, body: {} });
    expect(Number.isNaN(Date.parse(doc.recorded_at))).toBe(false);
  });

  it('rejects a body that carries its own header keys', () => {
    expect(() =>
      buildDocumentEnvelope({ ...identity, body: { change: 'x', recorded_at: 'y' } }),
    ).toThrow(/paqad\.plan body carries envelope header keys: change, recorded_at/);
  });
});

describe('stampBundleRow', () => {
  it('orders the header before the row and hashes with computeSessionRowHash', () => {
    const row = stampBundleRow({
      ...identity,
      docType: 'paqad.stage-evidence',
      row: { kind: 'stage_start', stage: 'development' },
      now: T1,
    });
    expect(Object.keys(row)).toEqual([...ENVELOPE_HEADER_KEYS, 'kind', 'stage']);
    expect(computeSessionRowHash(row)).toBe(row.content_hash);
    expect(validateEnvelopeHeader(row)).toEqual([]);
    const later = stampBundleRow({
      ...identity,
      docType: 'paqad.stage-evidence',
      row: { kind: 'stage_start', stage: 'development' },
      now: T2,
    });
    expect(later.content_hash).toBe(row.content_hash);
  });

  it('passes a valid row through the validator and throws on a rejected one', () => {
    const seen: unknown[] = [];
    stampBundleRow({
      ...identity,
      row: { kind: 'x' },
      validate: (stamped) => {
        seen.push(stamped);
        return [];
      },
    });
    expect(seen).toHaveLength(1);
    expect(() =>
      stampBundleRow({ ...identity, row: { kind: 'x' }, validate: () => ['bad kind'] }),
    ).toThrow('Invalid paqad.plan row: bad kind');
  });

  it('rejects a row that carries a header key', () => {
    expect(() => stampBundleRow({ ...identity, row: { ts: 'old' } })).not.toThrow();
    expect(() => stampBundleRow({ ...identity, row: { session_id: 'x' } })).toThrow(
      /header keys: session_id/,
    );
  });
});

describe('tolerant time + header readers', () => {
  it('rowRecordedAt prefers recorded_at, falls back to ts, else null', () => {
    expect(rowRecordedAt({ recorded_at: 'a', ts: 'b' })).toBe('a');
    expect(rowRecordedAt({ ts: 'b' })).toBe('b');
    expect(rowRecordedAt({ recorded_at: '', ts: 'b' })).toBe('b');
    expect(rowRecordedAt({ ts: 5 })).toBeNull();
  });

  it('docRecordedAt reads recorded_at, then created_at, captured_at, generated_at', () => {
    expect(docRecordedAt({ recorded_at: 'r', created_at: 'c' })).toBe('r');
    expect(docRecordedAt({ created_at: 'c', captured_at: 'x' })).toBe('c');
    expect(docRecordedAt({ captured_at: 'x', generated_at: 'g' })).toBe('x');
    expect(docRecordedAt({ generated_at: 'g' })).toBe('g');
    expect(docRecordedAt({})).toBeNull();
  });

  it('readEnvelope reads a new header as is', () => {
    const doc = buildDocumentEnvelope({ ...identity, body: {}, now: T1 });
    expect(readEnvelope(doc)).toEqual({
      schema_version: 2,
      doc_type: 'paqad.plan',
      change: CHANGE,
      session_id: SESSION,
      recorded_at: '2026-09-25T10:00:00.000Z',
      content_hash: doc.content_hash,
    });
  });

  it('readEnvelope maps the old keys and legacy doc types', () => {
    expect(
      readEnvelope({
        schema_version: 1,
        doc_type: 'paqad.duplication-run',
        ulid: CHANGE,
        session_first_seen: 's0',
        created_at: 'c',
        content_hash: 'h',
      }),
    ).toEqual({
      schema_version: 1,
      doc_type: 'paqad.duplication',
      change: CHANGE,
      session_id: 's0',
      recorded_at: 'c',
      content_hash: 'h',
    });
    expect(readEnvelope({ doc_type: 'paqad.rag-evidence', ts: 't' })).toMatchObject({
      doc_type: 'paqad.rag',
      recorded_at: 't',
      schema_version: null,
      change: null,
      session_id: null,
      content_hash: null,
    });
    expect(readEnvelope({})).toMatchObject({ doc_type: null, recorded_at: null });
  });

  it('readEnvelope returns null for a non-object', () => {
    expect(readEnvelope(null)).toBeNull();
    expect(readEnvelope('x')).toBeNull();
    expect(readEnvelope([1])).toBeNull();
  });

  it('normalizeDocType passes unknown names through', () => {
    expect(normalizeDocType('paqad.duplication-run')).toBe('paqad.duplication');
    expect(normalizeDocType('paqad.plan')).toBe('paqad.plan');
  });
});

describe('text documents', () => {
  it('buildTextHeader hashes the body with sha256, time-free', () => {
    const body = '# Spec\n\nFR-1: x\n';
    const header = buildTextHeader({ ...identity, docType: 'paqad.spec', body, now: T1 });
    expect(header.content_hash).toBe(sha256(body));
    expect(header.recorded_at).toBe('2026-09-25T10:00:00.000Z');
  });

  it('renders front matter and splits it back to the exact body', () => {
    const body = '# Request\n\nsee: https://example.com/a:b\n---\nnot a fence at start\n';
    const header = buildTextHeader({ ...identity, docType: 'paqad.request', body, now: T1 });
    const text = renderFrontMatter(header, body);
    expect(text.startsWith('---\nschema_version: 2\ndoc_type: "paqad.request"\n')).toBe(true);
    const split = splitFrontMatter(text);
    expect(split.body).toBe(body);
    expect(sha256(split.body)).toBe(header.content_hash);
    expect(split.header).toEqual({ ...header });
  });

  it('splits CRLF text, keeps the body bytes and a plain YAML value as text', () => {
    const split = splitFrontMatter('---\r\ndoc_type: paqad.spec\r\nnocolon\r\n---\r\nbody\r\n');
    expect(split.header).toEqual({ doc_type: 'paqad.spec' });
    // The body is the signed spec source, so its line endings survive the split.
    expect(split.body).toBe('body\r\n');
  });

  it('keeps a body that itself starts with front matter as body', () => {
    const body = '---\ntitle: mine\n---\n# Spec\n';
    const header = buildTextHeader({ ...identity, docType: 'paqad.spec', body, now: T1 });
    expect(splitFrontMatter(renderFrontMatter(header, body)).body).toBe(body);
  });

  it('keeps a non-scalar JSON value as its text', () => {
    expect(splitFrontMatter('---\nx: [1]\n---\n').header).toEqual({ x: '[1]' });
  });

  it('treats text with no or an unclosed front matter as all body', () => {
    expect(splitFrontMatter('# old spec\n')).toEqual({ header: null, body: '# old spec\n' });
    expect(splitFrontMatter('---\nkey: 1\nno close')).toEqual({
      header: null,
      body: '---\nkey: 1\nno close',
    });
  });

  it('renders and reads the report.html header tag, escaping <', () => {
    const header = buildEnvelopeHeader({
      ...identity,
      docType: 'paqad.report',
      sessionId: '</script><b>',
      contentHash: 'a'.repeat(64),
      now: T1,
    });
    const tag = renderHeaderScript(header);
    expect(tag.startsWith('<script type="application/json" id="paqad-header">{')).toBe(true);
    expect(tag.match(/<\/script>/g)).toHaveLength(1);
    const html = `<html><head>${tag}</head><body></body></html>`;
    expect(readHeaderScript(html)).toEqual({ ...header });
    expect(Object.keys(readHeaderScript(html)!)).toEqual([...ENVELOPE_HEADER_KEYS]);
  });

  it('reads null from report.html with no tag, a broken tag, or a non-object tag', () => {
    expect(readHeaderScript('<html></html>')).toBeNull();
    expect(
      readHeaderScript('<script type="application/json" id="paqad-header">{oops</script>'),
    ).toBeNull();
    expect(
      readHeaderScript('<script type="application/json" id="paqad-header">[1]</script>'),
    ).toBeNull();
    expect(
      readHeaderScript('<script type="application/json" id="paqad-header">null</script>'),
    ).toBeNull();
  });
});

describe('standard formats', () => {
  const header = buildEnvelopeHeader({
    ...identity,
    docType: 'paqad.ai-bom',
    contentHash: 'b'.repeat(64),
    now: T1,
  });

  it('writes the header into CycloneDX properties as paqad:<field> and reads it back', () => {
    const properties = toAiBomProperties(header);
    expect(properties.map((p) => p.name)).toEqual(
      ENVELOPE_HEADER_KEYS.map((key) => `${AI_BOM_HEADER_PREFIX}${key}`),
    );
    expect(properties.every((p) => typeof p.value === 'string')).toBe(true);
    const mixed = [
      { name: 'paqad:evidence:verdict', value: 'PASSED' },
      { name: 'other', value: 'x' },
      ...properties,
    ];
    expect(fromAiBomProperties(mixed)).toEqual({ ...header });
  });

  it('reads null from an AI-BOM without header properties', () => {
    expect(fromAiBomProperties(undefined)).toBeNull();
    expect(fromAiBomProperties([{ name: 'paqad:evidence:x', value: '1' }])).toBeNull();
  });

  it('puts the header first in the receipt paqad block', () => {
    const block = withReceiptHeader(header, {
      signing_mode: 'hash-chained',
      prev_receipt_hash: '0'.repeat(64),
      receipt_hash: 'c'.repeat(64),
    });
    expect(Object.keys(block)).toEqual([
      ...ENVELOPE_HEADER_KEYS,
      'signing_mode',
      'prev_receipt_hash',
      'receipt_hash',
    ]);
    expect(() => withReceiptHeader(header, { content_hash: 'x' })).toThrow(/header keys/);
  });
});

describe('ENVELOPE_SCHEMA_FRAGMENT', () => {
  it('composes into a closed file schema through allOf', () => {
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile({
      type: 'object',
      additionalProperties: false,
      allOf: [ENVELOPE_SCHEMA_FRAGMENT],
      properties: { ...ENVELOPE_HEADER_PROPERTIES, summary: { type: 'string' } },
    });
    const doc = buildDocumentEnvelope({ ...identity, body: { summary: 's' }, now: T1 });
    expect(validate(doc)).toBe(true);
    expect(validate({ ...doc, extra: 1 })).toBe(false);
    const headless: Record<string, unknown> = { ...doc };
    delete headless.change;
    expect(validate(headless)).toBe(false);
  });

  it('rejects a bad header value', () => {
    const doc = buildDocumentEnvelope({ ...identity, body: {}, now: T1 });
    expect(validateEnvelopeHeader({ ...doc, change: 'not-a-ulid' })).not.toEqual([]);
    expect(validateEnvelopeHeader({ ...doc, doc_type: 'plan' })).not.toEqual([]);
    expect(validateEnvelopeHeader({ ...doc, content_hash: 'ABC' })).not.toEqual([]);
    expect(validateEnvelopeHeader({ ...doc, schema_version: 0 })).not.toEqual([]);
    const noTime: Record<string, unknown> = { ...doc };
    delete noTime.recorded_at;
    expect(validateEnvelopeHeader(noTime)[0]).toMatch(/recorded_at/);
  });
});
