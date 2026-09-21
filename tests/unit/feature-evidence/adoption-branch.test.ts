import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { featureBranch } from '@/feature-evidence/adoption.js';
import { featureFilePath } from '@/feature-evidence/paths.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-adopt-branch-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const DIR = 'change-01JABCDEFGHJKMNPQRSTVWXYZ0';

/** Write a delivery.json for a bundle so deliveryBranch has something to read. */
function writeDelivery(root: string, body: Record<string, unknown>): void {
  const rel = featureFilePath(DIR, 'delivery');
  const full = join(root, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, JSON.stringify(body));
}

// featureBranch prefers an `open` row's stamped branch, then falls back to delivery.json's
// branch, then null. Passing `rows` explicitly exercises the fallbacks without a full bundle.
describe('featureBranch fallbacks (issue #404 / #567)', () => {
  it('returns the open-row branch when it is stamped', () => {
    const root = tempRoot();
    const rows = [{ kind: 'open', branch: 'feat/on-row' }] as never;
    expect(featureBranch(root, DIR, rows)).toBe('feat/on-row');
  });

  it('falls back to delivery.json when no open row carries a branch', () => {
    const root = tempRoot();
    writeDelivery(root, { branch: 'feat/from-delivery' });
    const rows = [{ kind: 'open' }] as never; // open row, no branch field
    expect(featureBranch(root, DIR, rows)).toBe('feat/from-delivery');
  });

  it('returns null when neither the row nor delivery.json names a branch', () => {
    const root = tempRoot();
    writeDelivery(root, { branch: '' }); // present but empty → not a usable branch
    const rows = [{ kind: 'open' }] as never;
    expect(featureBranch(root, DIR, rows)).toBeNull();
  });

  it('returns null when delivery.json is absent entirely', () => {
    const root = tempRoot();
    const rows = [{ kind: 'open' }] as never;
    expect(featureBranch(root, DIR, rows)).toBeNull();
  });
});
