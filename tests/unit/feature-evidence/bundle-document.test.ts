import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  documentSessionId,
  stampFeatureDocument,
  UNKNOWN_DOCUMENT_SESSION,
} from '@/feature-evidence/bundle-document.js';
import { seedFeatureRecord } from '@/feature-evidence/feature-record.js';
import { validateEnvelopeHeader } from '@/feature-evidence/schema.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-bundle-document-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const DIR = '581-packet-01JABCDEFGHJKMNPQRSTVWXYZ0';
const AT = '2026-09-25T00:00:00.000Z';

describe('documentSessionId (issue #581)', () => {
  it('prefers the writer session, trimmed', () => {
    expect(documentSessionId(tempRoot(), DIR, '  ses_1  ')).toBe('ses_1');
  });

  it('falls back to the session that opened the change, then unknown', () => {
    const root = tempRoot();
    expect(documentSessionId(root, DIR, '   ')).toBe(UNKNOWN_DOCUMENT_SESSION);
    seedFeatureRecord(root, DIR, { adapter: 'claude-code', sessionId: 'ses_owner' });
    expect(documentSessionId(root, DIR)).toBe('ses_owner');
    expect(documentSessionId(root, DIR, null)).toBe('ses_owner');
  });
});

describe('stampFeatureDocument (issue #581)', () => {
  it('stamps the six-field header for the change the folder names', () => {
    const doc = stampFeatureDocument({
      projectRoot: tempRoot(),
      dirName: DIR,
      docType: 'paqad.thing',
      schemaVersion: 2,
      sessionId: 'ses_1',
      body: { a: 1 },
      now: () => new Date(AT),
    });
    expect(doc).toMatchObject({
      schema_version: 2,
      doc_type: 'paqad.thing',
      change: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      session_id: 'ses_1',
      recorded_at: AT,
      a: 1,
    });
    expect(validateEnvelopeHeader(doc)).toEqual([]);
  });
});
