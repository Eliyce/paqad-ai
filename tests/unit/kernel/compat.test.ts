import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { capabilityLockPath, writeCapabilityDigest } from '@/kernel/capability-lock.js';
import { evaluateCapabilityCompat, isRefusedByCompat } from '@/kernel/compat.js';
import { getCapability } from '@/kernel/registry.js';

// Buildout F7 (decision D2) — version-skew compatibility between the install's
// registry (the mandatory floor) and the project's blessed version vector.

const RS = getCapability('rule-scripts');
const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-compat-'));
  roots.push(root);
  return root;
}

/** Write a lock whose rule-scripts entry carries crafted versions. */
function writeLockVersions(root: string, policy: number, record: number): void {
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(
    capabilityLockPath(root),
    JSON.stringify({
      schema_version: 1,
      generated_at: '2026-01-01T00:00:00.000Z',
      capabilities: {
        'rule-scripts': { digest: 'd', policy_version: policy, record_version: record },
      },
    }),
    'utf8',
  );
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('evaluateCapabilityCompat', () => {
  it('is current when the bless matches the install registry', () => {
    const root = tempRoot();
    writeCapabilityDigest(root, 'rule-scripts', 'd');
    expect(evaluateCapabilityCompat(root, RS)).toBe('current');
  });

  it('is unversioned with no lock at all', () => {
    expect(evaluateCapabilityCompat(tempRoot(), RS)).toBe('unversioned');
  });

  it('is unversioned for a pre-F7 digest-only lock', () => {
    const root = tempRoot();
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      capabilityLockPath(root),
      JSON.stringify({
        schema_version: 1,
        generated_at: '2026-01-01T00:00:00.000Z',
        capabilities: { 'rule-scripts': { digest: 'd' } },
      }),
      'utf8',
    );
    expect(evaluateCapabilityCompat(root, RS)).toBe('unversioned');
  });

  it('is project-behind when the bless predates a schema bump (lock < registry)', () => {
    const root = tempRoot();
    writeLockVersions(root, RS.policySchemaVersion - 1, RS.recordSchemaVersion);
    expect(evaluateCapabilityCompat(root, RS)).toBe('project-behind');
  });

  it('is project-ahead when the policy version exceeds the install', () => {
    const root = tempRoot();
    writeLockVersions(root, RS.policySchemaVersion + 1, RS.recordSchemaVersion);
    expect(evaluateCapabilityCompat(root, RS)).toBe('project-ahead');
  });

  it('is project-ahead when only the record version exceeds the install', () => {
    const root = tempRoot();
    writeLockVersions(root, RS.policySchemaVersion, RS.recordSchemaVersion + 1);
    expect(evaluateCapabilityCompat(root, RS)).toBe('project-ahead');
  });

  it('treats ahead-on-one, behind-on-the-other as project-ahead (refuse dominates)', () => {
    const root = tempRoot();
    writeLockVersions(root, RS.policySchemaVersion + 1, RS.recordSchemaVersion - 1);
    expect(evaluateCapabilityCompat(root, RS)).toBe('project-ahead');
  });
});

describe('isRefusedByCompat', () => {
  it('refuses only the project-ahead case', () => {
    expect(isRefusedByCompat('project-ahead')).toBe(true);
    expect(isRefusedByCompat('current')).toBe(false);
    expect(isRefusedByCompat('project-behind')).toBe(false);
    expect(isRefusedByCompat('unversioned')).toBe(false);
  });
});
