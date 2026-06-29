import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  capabilityLockPath,
  readCapabilityDigest,
  readCapabilityLock,
  writeCapabilityDigest,
} from '@/kernel/capability-lock.js';

// Buildout F5 — the engine-owned integrity lock. Read is null-safe; write merges
// so one capability's blessing never clobbers another's.

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-caplock-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('capability-lock', () => {
  it('reads null when no lock exists', () => {
    const root = tempRoot();
    expect(readCapabilityLock(root)).toBeNull();
    expect(readCapabilityDigest(root, 'rule-scripts')).toBeNull();
  });

  it('reads null when the lock file is unparseable (treated as no lock)', () => {
    const root = tempRoot();
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(capabilityLockPath(root), '{ not valid json', 'utf8');
    expect(readCapabilityLock(root)).toBeNull();
    expect(readCapabilityDigest(root, 'rule-scripts')).toBeNull();
  });

  it('reads null when the lock parses to a non-object (e.g. JSON null)', () => {
    const root = tempRoot();
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(capabilityLockPath(root), 'null', 'utf8');
    expect(readCapabilityLock(root)).toBeNull();
  });

  it('writes then reads back a capability digest', () => {
    const root = tempRoot();
    writeCapabilityDigest(root, 'rule-scripts', 'abc123');
    expect(readCapabilityDigest(root, 'rule-scripts')).toBe('abc123');
    const lock = readCapabilityLock(root);
    expect(lock?.schema_version).toBe(1);
  });

  it('merges a new capability without clobbering an existing one', () => {
    const root = tempRoot();
    writeCapabilityDigest(root, 'rule-scripts', 'rs-digest');
    writeCapabilityDigest(root, 'stages', 'stages-digest');
    expect(readCapabilityDigest(root, 'rule-scripts')).toBe('rs-digest');
    expect(readCapabilityDigest(root, 'stages')).toBe('stages-digest');
  });

  it('overwrites the same capability digest on re-bless', () => {
    const root = tempRoot();
    writeCapabilityDigest(root, 'rule-scripts', 'old');
    writeCapabilityDigest(root, 'rule-scripts', 'new');
    expect(readCapabilityDigest(root, 'rule-scripts')).toBe('new');
  });
});
