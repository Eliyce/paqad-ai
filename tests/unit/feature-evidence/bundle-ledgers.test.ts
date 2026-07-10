import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  appendRuleRun,
  mirrorRagRow,
  readRuleRun,
  resolveRagHome,
} from '@/feature-evidence/bundle-ledgers.js';
import { chatRagPath } from '@/feature-evidence/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { readUnitFile, stampSessionRow } from '@/session-ledger/ledger.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-fe-bundle-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function activeFeature(root: string): string {
  return openFeatureChange(root, 'ses_1', {
    adapter: 'claude-code',
    title: 'Route first workflows',
    issue: '339',
    ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
  });
}

describe('RAG two-home routing', () => {
  it('routes to _chat when no feature is active (the one-prompt lag)', () => {
    const root = tempRoot();
    expect(resolveRagHome(root, 'ses_1')).toBe(chatRagPath('ses_1'));
  });

  it('routes to the active feature bundle once a feature is open', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    expect(resolveRagHome(root, 'ses_1')).toBe(`.paqad/ledger/feature-evidence/${dir}/rag.jsonl`);
  });

  it('mirrorRagRow writes the stamped row into the resolved home', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const stamped = stampSessionRow('paqad.rag-evidence', 'ses_1', { kind: 'retrieval' });
    mirrorRagRow(root, 'ses_1', stamped);
    const rows = readUnitFile(root, `.paqad/ledger/feature-evidence/${dir}/rag.jsonl`);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('retrieval');
  });

  it('mirrorRagRow is best-effort — a bad root never throws', () => {
    const stamped = stampSessionRow('paqad.rag-evidence', 'ses_1', { kind: 'retrieval' });
    expect(() => mirrorRagRow('\0not-a-real-root', 'ses_1', stamped)).not.toThrow();
  });
});

describe('per-feature rule-run.jsonl', () => {
  it('appends a rule-run row into the active feature and reads it back', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const row = appendRuleRun(root, 'ses_1', {
      kind: 'findings',
      counts: { deterministic: 2, heuristic: 1, skipped: 0 },
      blocking: true,
    });
    expect(row).not.toBeNull();
    const rows = readRuleRun(root, dir);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'findings', blocking: true });
  });

  it('is a no-op (null) when no feature is active', () => {
    const root = tempRoot();
    expect(appendRuleRun(root, 'ses_1', { kind: 'drift', counts: {}, blocking: false })).toBeNull();
  });
});
