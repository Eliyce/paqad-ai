import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { validateRagEvidenceRow } from '@/rag-ledger/schema.js';
import { foldRagEvidenceSession } from '@/rag-ledger/fold.js';
import {
  chatRagPath,
  featureFilePath,
  featureSessionControlPath,
} from '@/feature-evidence/paths.js';
import { validateEnvelopeHeader } from '@/feature-evidence/schema.js';
import { computeSessionRowHash, readUnitFile } from '@/session-ledger/ledger.js';

const mjs = await import(
  pathToFileURL(resolve(__dirname, '../../../runtime/scripts/rag-evidence-record.mjs')).href
);

function markActiveFeature(root: string, sessionId: string, dirName: string): void {
  const control = join(root, featureSessionControlPath(sessionId));
  mkdirSync(dirname(control), { recursive: true });
  writeFileSync(
    control,
    JSON.stringify({
      schema_version: 1,
      doc_type: 'paqad.feature-session',
      session_id: sessionId,
      active: dirName,
      paused: [],
      lane: null,
    }),
    'utf8',
  );
}

describe('runtime rag-evidence-record.mjs (seam recorder)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-seam-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('sectionsFromBlock detects the injected section headings', () => {
    const block =
      '[paqad-context]\n## paqad rule manifest — 3 rules\n## Codebase memory — 1 fact\n## Retrieved context — 2 slices\n## Base drift\n';
    expect(mjs.sectionsFromBlock(block).sort()).toEqual(['drift', 'memory', 'retrieval', 'rules']);
  });

  it('resolveSeamSessionId persists a host id so the worker aligns', () => {
    expect(mjs.resolveSeamSessionId(root, 'ses_host')).toBe('ses_host');
    expect(readFileSync(join(root, PATHS.LEDGER_SESSION_ID), 'utf8').trim()).toBe('ses_host');
    expect(mjs.resolveSeamSessionId(root, undefined)).toBe('ses_host');
  });

  it('records a `used` outcome into the _chat home that the TS reader + AJV schema accept', () => {
    const row = mjs.recordSeamOutcome(root, {
      sessionId: 'ses_seam',
      ragEnabled: true,
      adapter: 'claude-code',
      kind: 'used',
      fields: { injected: true, injected_sections: ['rules', 'retrieval'], bytes_injected: 240 },
    });
    expect(row.kind).toBe('used');

    const rows = readUnitFile(root, chatRagPath('ses_seam'));
    expect(rows.map((r) => r.kind)).toEqual(['open', 'used']);
    for (const persisted of rows) {
      expect(validateRagEvidenceRow(persisted)).toEqual([]);
    }
    const fold = foldRagEvidenceSession(root, 'ses_seam');
    expect(fold.totals.used_count).toBe(1);
    expect(fold.coverage.prompts_with_rag).toBe(1);
  });

  it('routes a seam row into the active feature bundle when _session marks one', () => {
    const dirName = 'PQD-9-demo-01ARZ3NDEKTSV4RRFFQ69G5FAV';
    markActiveFeature(root, 'ses_feat', dirName);

    mjs.recordSeamOutcome(root, {
      sessionId: 'ses_feat',
      ragEnabled: true,
      adapter: 'claude-code',
      kind: 'used',
      fields: { injected: true, injected_sections: ['retrieval'], bytes_injected: 120 },
    });

    const bundleRows = readUnitFile(root, featureFilePath(dirName, 'rag'));
    expect(bundleRows.map((r) => r.kind)).toEqual(['open', 'used']);
    for (const persisted of bundleRows as unknown as Record<string, unknown>[]) {
      expect(Object.keys(persisted).slice(0, 6)).toEqual([
        'schema_version',
        'doc_type',
        'change',
        'session_id',
        'recorded_at',
        'content_hash',
      ]);
      expect(persisted).toMatchObject({
        schema_version: 2,
        doc_type: 'paqad.rag',
        change: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        session_id: 'ses_feat',
      });
      expect(persisted).not.toHaveProperty('adapter');
      expect(persisted).not.toHaveProperty('ts');
      expect(persisted.content_hash).toBe(computeSessionRowHash(persisted));
      expect(validateEnvelopeHeader(persisted)).toEqual([]);
    }
    expect(readUnitFile(root, chatRagPath('ses_feat'))).toHaveLength(0);
    const fold = foldRagEvidenceSession(root, 'ses_feat');
    expect(fold.totals.used_count).toBe(1);
  });

  it('records a `fallback` outcome on an empty prompt', () => {
    mjs.recordSeamOutcome(root, {
      sessionId: 'ses_fb',
      ragEnabled: true,
      adapter: 'claude-code',
      kind: 'fallback',
      fields: { injected: false, fallback_reason: 'cold' },
    });
    const fold = foldRagEvidenceSession(root, 'ses_fb');
    expect(fold.totals.fallback_count).toBe(1);
    expect(fold.coverage.fallback_reasons.cold).toBe(1);
  });
});
