import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { FLAKY_REGISTRY_SCHEMA_VERSION } from '@/core/types/flaky.js';
import {
  activeQuarantines,
  entryKey,
  markCleared,
  readFlakyRegistry,
  upsertQuarantine,
  writeFlakyRegistry,
} from '@/flaky/registry.js';

const NOW = '2026-06-08T00:00:00.000Z';
const LATER = '2026-06-09T00:00:00.000Z';

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    test_id: 'suite > flips sometimes',
    suite: 'suite',
    reruns: 4,
    passes: 2,
    failures: 2,
    suspected_causes: ['timing' as const],
    modules: ['cli-rag'],
    now: NOW,
    ...overrides,
  };
}

describe('flaky registry persistence', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-flaky-reg-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('returns an empty registry when none exists', async () => {
    const registry = await readFlakyRegistry(projectRoot, NOW);
    expect(registry.schema_version).toBe(FLAKY_REGISTRY_SCHEMA_VERSION);
    expect(registry.entries).toEqual([]);
  });

  it('round-trips a quarantine entry atomically', async () => {
    let registry = await readFlakyRegistry(projectRoot, NOW);
    registry = upsertQuarantine(registry, baseInput());
    const path = await writeFlakyRegistry(projectRoot, registry);
    expect(path).toBe(join(projectRoot, PATHS.FLAKY_REGISTRY));

    const reread = await readFlakyRegistry(projectRoot);
    expect(reread.entries).toHaveLength(1);
    expect(reread.entries[0].status).toBe('quarantined');
    expect(reread.entries[0].suspected_causes).toEqual(['timing']);
  });

  it('treats a corrupt registry file as empty (a bad read must never block a build)', async () => {
    const path = join(projectRoot, PATHS.FLAKY_REGISTRY);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{ not json');
    const registry = await readFlakyRegistry(projectRoot, NOW);
    expect(registry.entries).toEqual([]);
  });

  it('treats a non-array entries field as empty', async () => {
    const path = join(projectRoot, PATHS.FLAKY_REGISTRY);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ entries: 'nope' }));
    const registry = await readFlakyRegistry(projectRoot, NOW);
    expect(registry.entries).toEqual([]);
  });
});

describe('upsertQuarantine / markCleared — never silent deletion', () => {
  it('keys by test_id + suite', () => {
    expect(entryKey('t', 's')).toBe('s::t');
    expect(entryKey('t', null)).toBe('::t');
  });

  it('refreshes an existing entry and preserves first_seen', () => {
    let registry = { schema_version: FLAKY_REGISTRY_SCHEMA_VERSION, updated_at: NOW, entries: [] };
    registry = upsertQuarantine(registry, baseInput());
    registry = upsertQuarantine(registry, baseInput({ now: LATER, passes: 3, failures: 1 }));
    expect(registry.entries).toHaveLength(1);
    expect(registry.entries[0].first_seen).toBe(NOW);
    expect(registry.entries[0].updated_at).toBe(LATER);
    expect(registry.entries[0].evidence.passes).toBe(3);
  });

  it('re-quarantining a cleared test re-opens it, keeping the original first_seen', () => {
    let registry = { schema_version: FLAKY_REGISTRY_SCHEMA_VERSION, updated_at: NOW, entries: [] };
    registry = upsertQuarantine(registry, baseInput());
    registry = markCleared(registry, 'suite > flips sometimes', 'suite', 'fixed', LATER);
    expect(activeQuarantines(registry)).toHaveLength(0);
    registry = upsertQuarantine(registry, baseInput({ now: LATER }));
    expect(activeQuarantines(registry)).toHaveLength(1);
    expect(registry.entries[0].first_seen).toBe(NOW);
  });

  it('marks an entry cleared without deleting it (audit trail kept)', () => {
    let registry = { schema_version: FLAKY_REGISTRY_SCHEMA_VERSION, updated_at: NOW, entries: [] };
    registry = upsertQuarantine(registry, baseInput());
    registry = markCleared(registry, 'suite > flips sometimes', 'suite', 'empirical', LATER);
    expect(registry.entries).toHaveLength(1);
    expect(registry.entries[0].status).toBe('cleared');
    expect(registry.entries[0].cleared_reason).toBe('empirical');
  });

  it('is a no-op when clearing a key with no active quarantine', () => {
    const registry = {
      schema_version: FLAKY_REGISTRY_SCHEMA_VERSION,
      updated_at: NOW,
      entries: [],
    };
    const after = markCleared(registry, 'missing', null, 'x', LATER);
    expect(after).toBe(registry);
  });
});
