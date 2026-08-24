import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readSessionDoc } from '@/session-ledger/ledger.js';
import {
  NON_FEATURE_SKIP_DOC_TYPE,
  recordNonFeatureVerificationSkip,
} from '@/session-ledger/non-feature-skip-audit.js';

// Issue #499 — a completion turn that skipped verification because the session was a
// non-feature workflow records ONE audit row so the skip is observable, never silent.

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-nonfeature-skip-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('recordNonFeatureVerificationSkip', () => {
  it('records one row keyed by session, naming the routed workflow', () => {
    const root = tempRoot();
    const result = recordNonFeatureVerificationSkip(root, {
      sessionId: 'ses_q_1',
      workflow: 'project-question',
      origin: 'hook-completion',
      adapter: 'claude-code',
    });
    expect(result).not.toBeNull();
    const rows = readSessionDoc(root, NON_FEATURE_SKIP_DOC_TYPE, 'ses_q_1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      doc_type: NON_FEATURE_SKIP_DOC_TYPE,
      session_id: 'ses_q_1',
      kind: 'open',
      reason: 'non-feature-route',
      workflow: 'project-question',
      origin: 'hook-completion',
      adapter: 'claude-code',
    });
  });

  it('is idempotent — a second record for the same session adds no row', () => {
    const root = tempRoot();
    expect(recordNonFeatureVerificationSkip(root, { sessionId: 'ses_a' })).not.toBeNull();
    expect(recordNonFeatureVerificationSkip(root, { sessionId: 'ses_a' })).toBeNull();
    expect(readSessionDoc(root, NON_FEATURE_SKIP_DOC_TYPE, 'ses_a')).toHaveLength(1);
  });

  it('defaults workflow/origin/adapter to "unknown" when not supplied', () => {
    const root = tempRoot();
    recordNonFeatureVerificationSkip(root, { sessionId: 'ses_b' });
    const rows = readSessionDoc(root, NON_FEATURE_SKIP_DOC_TYPE, 'ses_b');
    expect(rows[0]).toMatchObject({ workflow: 'unknown', origin: 'unknown', adapter: 'unknown' });
  });

  it('returns null (never throws) when the ledger cannot be written', () => {
    const dir = tempRoot();
    const filePath = join(dir, 'not-a-dir');
    writeFileSync(filePath, 'x', 'utf8');
    expect(recordNonFeatureVerificationSkip(filePath, { sessionId: 'ses_x' })).toBeNull();
  });
});
