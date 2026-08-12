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
import { readUnitFile } from '@/session-ledger/ledger.js';

// The pure-mjs seam recorder must produce rows the TS reader reads and the AJV schema
// validates — this test pins that cross-format contract so the two never drift. Issue #468
// Phase C: the rows now land in the two-home `rag.jsonl` (the session's `_chat` home, or a
// feature bundle when `_session` marks one active), and the ordinal `.open` lives in `_chat`.
const mjs = await import(
  pathToFileURL(resolve(__dirname, '../../../runtime/scripts/rag-evidence-record.mjs')).href
);

/** Write the per-session control file marking `dirName` as the active feature. */
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
    // No hint → reuse the cached id.
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

    // Issue #468 Phase C — no active feature, so the rows land in the session's `_chat`
    // `rag.jsonl` and the retired `paqad.rag-evidence/` substrate is never created.
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

    // The row lands in the bundle's `rag.jsonl`, NOT the `_chat` home.
    const bundleRows = readUnitFile(root, featureFilePath(dirName, 'rag'));
    expect(bundleRows.map((r) => r.kind)).toEqual(['open', 'used']);
    expect(readUnitFile(root, chatRagPath('ses_feat'))).toHaveLength(0);
    // The re-pointed fold unions the bundle rows (filtered by session_id) with `_chat`.
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
