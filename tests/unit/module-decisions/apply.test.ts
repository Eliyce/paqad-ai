import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  applyModuleMapMutation,
  atomicWriteModuleMap,
  snapshotModuleMap,
} from '@/module-decisions/apply.js';
import { readModuleMapEvents } from '@/module-decisions/events.js';

describe('module-decisions/apply', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-apply-'));
    mkdirSync(join(root, 'docs/instructions/rules'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('snapshots existing module-map.yml to a timestamped history file', () => {
    writeFileSync(join(root, PATHS.MODULE_MAP), 'version: 1\nmodules: []\n');
    const snap = snapshotModuleMap(root, 'MD-0001', new Date('2026-05-28T00:00:00.000Z'));
    expect(existsSync(snap)).toBe(true);
    expect(readFileSync(snap, 'utf8')).toBe('version: 1\nmodules: []\n');
    expect(snap).toMatch(/MD-0001\.yml$/);
  });

  it('writes an empty snapshot when no module-map exists yet', () => {
    const snap = snapshotModuleMap(root, 'first-decl');
    expect(existsSync(snap)).toBe(true);
    expect(readFileSync(snap, 'utf8')).toBe('');
  });

  it('sanitises unsafe characters in via', () => {
    const snap = snapshotModuleMap(root, '../etc/passwd');
    expect(snap).not.toContain('../');
    expect(snap).toMatch(/\.paqad\/module-map\/history\//);
  });

  it('atomicWriteModuleMap replaces the file in one step', () => {
    writeFileSync(join(root, PATHS.MODULE_MAP), 'old\n');
    atomicWriteModuleMap(root, 'new content\n');
    expect(readFileSync(join(root, PATHS.MODULE_MAP), 'utf8')).toBe('new content\n');
    // No leftover tmp file alongside.
    const siblings = readdirSync(join(root, 'docs/instructions/rules'));
    expect(siblings.filter((f) => f.startsWith('module-map.yml.tmp-'))).toEqual([]);
  });

  it('applyModuleMapMutation: snapshot → write → event, all visible after', () => {
    writeFileSync(join(root, PATHS.MODULE_MAP), 'version: 1\nmodules: []\n');
    const result = applyModuleMapMutation({
      projectRoot: root,
      newMapYaml: 'version: 2\nmodules: [{slug: payments}]\n',
      via: 'MD-0001',
      event: {
        type: 'module.declared',
        slug: 'payments',
        via: 'MD-0001',
        approved_by: 'user',
      },
    });

    expect(existsSync(result.snapshot_path)).toBe(true);
    expect(readFileSync(result.snapshot_path, 'utf8')).toBe('version: 1\nmodules: []\n');
    expect(readFileSync(join(root, PATHS.MODULE_MAP), 'utf8')).toContain('slug: payments');

    const events = readModuleMapEvents(root);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('module.declared');
    expect(events[0]?.slug).toBe('payments');
    expect(events[0]?.via).toBe('MD-0001');
    expect(events[0]?.approved_by).toBe('user');
    expect(events[0]?.ts).toBe(result.applied_at);
  });

  it('applyModuleMapMutation works on first declaration (no prior map)', () => {
    const result = applyModuleMapMutation({
      projectRoot: root,
      newMapYaml: 'version: 1\nmodules: [{slug: first}]\n',
      via: 'MD-0001',
      event: { type: 'module.declared', slug: 'first', via: 'MD-0001' },
    });
    expect(readFileSync(result.snapshot_path, 'utf8')).toBe('');
    expect(readFileSync(join(root, PATHS.MODULE_MAP), 'utf8')).toContain('slug: first');
  });
});
