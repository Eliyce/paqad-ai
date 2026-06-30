import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  readDecisionEvidence,
  recordDecisionDiscarded,
  recordDecisionExpired,
  recordDecisionOpened,
  recordDecisionResolved,
  recordDecisionSuperseded,
} from '@/planning/decision-ledger.js';

// Buildout F6 — decision-pause evidence on the session-ledger (the decision store fold).

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-decision-ledger-'));
  roots.push(root);
  return root;
}

function open(root: string, id: string, createdAt = '2026-04-27T12:00:00Z'): void {
  recordDecisionOpened(root, { decisionId: id, category: 'scope', title: `Q ${id}`, createdAt });
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('decision-ledger', () => {
  it('is empty when nothing has been recorded', () => {
    expect(readDecisionEvidence(tempRoot())).toEqual({
      pending: [],
      resolvedCount: 0,
      expiredCount: 0,
    });
  });

  it('reports an opened decision as pending with its title and created_at', () => {
    const root = tempRoot();
    open(root, 'D-1', '2026-04-20T00:00:00Z');
    const { pending, resolvedCount, expiredCount } = readDecisionEvidence(root);
    expect(pending).toEqual([{ id: 'D-1', title: 'Q D-1', createdAt: '2026-04-20T00:00:00Z' }]);
    expect(resolvedCount).toBe(0);
    expect(expiredCount).toBe(0);
  });

  it('folds the latest lifecycle event per decision id (resolved leaves pending)', () => {
    const root = tempRoot();
    open(root, 'D-1');
    open(root, 'D-2');
    recordDecisionResolved(root, 'D-1', 'resolved', 'human');
    const { pending, resolvedCount } = readDecisionEvidence(root);
    expect(pending.map((p) => p.id)).toEqual(['D-2']);
    expect(resolvedCount).toBe(1);
  });

  it('counts superseded with resolved (both live in the resolved bucket)', () => {
    const root = tempRoot();
    open(root, 'D-1');
    open(root, 'D-2');
    recordDecisionResolved(root, 'D-1', 'delegated', 'human');
    recordDecisionSuperseded(root, 'D-2');
    const { pending, resolvedCount } = readDecisionEvidence(root);
    expect(pending).toEqual([]);
    expect(resolvedCount).toBe(2);
  });

  it('counts an expired decision separately and drops it from pending', () => {
    const root = tempRoot();
    open(root, 'D-1');
    recordDecisionExpired(root, 'D-1');
    const { pending, resolvedCount, expiredCount } = readDecisionEvidence(root);
    expect(pending).toEqual([]);
    expect(resolvedCount).toBe(0);
    expect(expiredCount).toBe(1);
  });

  it('drops a discarded decision from every bucket', () => {
    const root = tempRoot();
    open(root, 'D-1');
    recordDecisionDiscarded(root, 'D-1', 'no longer relevant');
    expect(readDecisionEvidence(root)).toEqual({
      pending: [],
      resolvedCount: 0,
      expiredCount: 0,
    });
  });

  it('falls back to the id as title when the opened row omitted it', () => {
    const root = tempRoot();
    recordDecisionOpened(root, {
      decisionId: 'D-9',
      category: 'scope',
      title: '',
      createdAt: '',
    });
    const [packet] = readDecisionEvidence(root).pending;
    expect(packet).toEqual({ id: 'D-9', title: 'D-9', createdAt: null });
  });

  it('is best-effort — recording on an unwritable root never throws', () => {
    const dir = tempRoot();
    const filePath = join(dir, 'not-a-dir');
    writeFileSync(filePath, 'x', 'utf8');
    expect(() => open(filePath, 'D-1')).not.toThrow();
    expect(readDecisionEvidence(filePath).pending).toEqual([]);
  });
});
