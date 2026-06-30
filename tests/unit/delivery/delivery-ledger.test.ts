import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readLatestDeliveryEvidence, recordDeliveryEvidence } from '@/delivery/delivery-ledger.js';
import { detectDelivery } from '@/delivery/detection.js';

// Buildout F6 — delivery evidence on the session-ledger (the delivery store fold).

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-delivery-ledger-'));
  roots.push(root);
  return root;
}

const GITHUB = detectDelivery({
  remoteUrl: 'git@github.com:o/r.git',
  defaultBranch: 'origin/main',
  branchNames: ['feat/a'],
  recentCommitSubjects: ['feat: a'],
});

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('delivery-ledger', () => {
  it('is null when nothing has been recorded', () => {
    expect(readLatestDeliveryEvidence(tempRoot())).toBeNull();
  });

  it('records and reads back the detected conventions', () => {
    const root = tempRoot();
    recordDeliveryEvidence(root, GITHUB);
    expect(readLatestDeliveryEvidence(root)?.host?.value).toBe('github');
  });

  it('returns the latest detection when recorded more than once', () => {
    const root = tempRoot();
    recordDeliveryEvidence(root, GITHUB);
    const gitlab = detectDelivery({
      remoteUrl: 'git@gitlab.com:o/r.git',
      defaultBranch: 'origin/main',
      branchNames: ['feat/a'],
      recentCommitSubjects: ['feat: a'],
    });
    recordDeliveryEvidence(root, gitlab);
    expect(readLatestDeliveryEvidence(root)?.host?.value).toBe('gitlab');
  });

  it('is best-effort — recording on an unwritable root never throws', () => {
    const dir = tempRoot();
    const filePath = join(dir, 'not-a-dir');
    writeFileSync(filePath, 'x', 'utf8');
    expect(() => recordDeliveryEvidence(filePath, GITHUB)).not.toThrow();
    expect(readLatestDeliveryEvidence(filePath)).toBeNull();
  });
});
