import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DISABLED_SESSION_DOC_TYPE,
  recordDisabledSession,
} from '@/session-ledger/disabled-audit.js';
import { readSessionDoc } from '@/session-ledger/ledger.js';

// Buildout F2b (decision D1) — a session that runs while paqad is disabled is
// audited with ONE row on the session-ledger so the bypass is visible.

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-disabled-audit-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('recordDisabledSession', () => {
  it('records one disabled-session row keyed by the host session id', () => {
    const root = tempRoot();
    const result = recordDisabledSession(root, {
      sessionId: 'ses_host_123',
      origin: 'hook-completion',
      adapter: 'claude-code',
    });
    expect(result).not.toBeNull();
    const rows = readSessionDoc(root, DISABLED_SESSION_DOC_TYPE, 'ses_host_123');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      doc_type: DISABLED_SESSION_DOC_TYPE,
      session_id: 'ses_host_123',
      kind: 'open',
      reason: 'paqad-disabled',
      origin: 'hook-completion',
      adapter: 'claude-code',
    });
    expect(typeof rows[0].content_hash).toBe('string');
    expect(typeof rows[0].ts).toBe('string');
  });

  it('is idempotent — a second record for the same session adds no row', () => {
    const root = tempRoot();
    expect(recordDisabledSession(root, { sessionId: 'ses_a' })).not.toBeNull();
    expect(recordDisabledSession(root, { sessionId: 'ses_a' })).toBeNull();
    expect(readSessionDoc(root, DISABLED_SESSION_DOC_TYPE, 'ses_a')).toHaveLength(1);
  });

  it('defaults origin and adapter to "unknown" when not supplied', () => {
    const root = tempRoot();
    recordDisabledSession(root, { sessionId: 'ses_b' });
    const rows = readSessionDoc(root, DISABLED_SESSION_DOC_TYPE, 'ses_b');
    expect(rows[0]).toMatchObject({ origin: 'unknown', adapter: 'unknown' });
  });

  it('mints and reuses a local session id when no host hint is given', () => {
    const root = tempRoot();
    const first = recordDisabledSession(root, {});
    expect(first).not.toBeNull();
    // Same machine-local session resolves to the same id → still idempotent.
    expect(recordDisabledSession(root, {})).toBeNull();
  });

  it('returns null (never throws) when the ledger cannot be written', () => {
    // A projectRoot that is a FILE makes the recorder's mkdirSync fail — the
    // best-effort catch must swallow it and return null.
    const dir = tempRoot();
    const filePath = join(dir, 'not-a-dir');
    writeFileSync(filePath, 'x', 'utf8');
    expect(recordDisabledSession(filePath, { sessionId: 'ses_x' })).toBeNull();
  });
});
