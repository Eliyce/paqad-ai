import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { validateRagEvidenceRow } from '@/rag-ledger/schema.js';
import { foldRagEvidenceSession } from '@/rag-ledger/fold.js';
import { readSessionDoc } from '@/session-ledger/ledger.js';
import { RAG_EVIDENCE_DOC_TYPE } from '@/rag-ledger/types.js';

// The pure-mjs seam recorder must produce rows the TS substrate reads and the AJV schema
// validates — this test pins that cross-format contract so the two never drift.
const mjs = await import(
  pathToFileURL(resolve(__dirname, '../../../runtime/scripts/rag-evidence-record.mjs')).href
);

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
    // No hint → reuse the cached id.
    expect(mjs.resolveSeamSessionId(root, undefined)).toBe('ses_host');
  });

  it('records a `used` outcome that the TS reader + AJV schema accept', () => {
    const row = mjs.recordSeamOutcome(root, {
      sessionId: 'ses_seam',
      ragEnabled: true,
      adapter: 'claude-code',
      kind: 'used',
      fields: { injected: true, injected_sections: ['rules', 'retrieval'], bytes_injected: 240 },
    });
    expect(row.kind).toBe('used');

    const rows = readSessionDoc(root, RAG_EVIDENCE_DOC_TYPE, 'ses_seam');
    expect(rows.map((r) => r.kind)).toEqual(['open', 'used']);
    for (const persisted of rows) {
      expect(validateRagEvidenceRow(persisted)).toEqual([]);
    }
    const fold = foldRagEvidenceSession(root, 'ses_seam');
    expect(fold.totals.used_count).toBe(1);
    expect(fold.coverage.prompts_with_rag).toBe(1);
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
