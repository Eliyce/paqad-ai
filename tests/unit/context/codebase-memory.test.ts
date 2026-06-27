import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_MEMORY_ENTRIES,
  MEMORY_SECTION_CHAR_BUDGET,
  composeMemorySection,
  emptyMemoryStore,
  gatherCodebaseMemory,
  loadCodebaseMemory,
  memoryStorePath,
  recordCodebaseMemory,
  upsertMemoryEntry,
  type CodebaseMemoryEntry,
} from '@/context/codebase-memory.js';
import { PATHS } from '@/core/constants/paths.js';

function entry(partial: Partial<CodebaseMemoryEntry> & { key: string }): CodebaseMemoryEntry {
  return {
    id: `repo-fact:${partial.key}`,
    kind: 'repo-fact',
    text: 'a fact',
    updated_at: '2026-06-27T00:00:00.000Z',
    ...partial,
  };
}

describe('upsertMemoryEntry', () => {
  it('appends a new key', () => {
    const store = upsertMemoryEntry(
      emptyMemoryStore(),
      { kind: 'repo-fact', key: 'auth-lives-in', text: 'auth is in src/auth' },
      '2026-06-27T01:00:00.000Z',
    );
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0]).toMatchObject({
      id: 'repo-fact:auth-lives-in',
      kind: 'repo-fact',
      key: 'auth-lives-in',
      text: 'auth is in src/auth',
      updated_at: '2026-06-27T01:00:00.000Z',
    });
  });

  it('evolves an existing (kind, key) in place rather than duplicating', () => {
    let store = upsertMemoryEntry(
      emptyMemoryStore(),
      { kind: 'decision', key: 'db', text: 'use postgres' },
      '2026-06-27T01:00:00.000Z',
    );
    store = upsertMemoryEntry(
      store,
      { kind: 'decision', key: 'db', text: 'use postgres 16 with pgvector' },
      '2026-06-27T02:00:00.000Z',
    );
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0].text).toBe('use postgres 16 with pgvector');
    expect(store.entries[0].updated_at).toBe('2026-06-27T02:00:00.000Z');
  });

  it('treats the same key under different kinds as distinct facts', () => {
    let store = upsertMemoryEntry(
      emptyMemoryStore(),
      { kind: 'repo-fact', key: 'x', text: 'fact' },
      '2026-06-27T01:00:00.000Z',
    );
    store = upsertMemoryEntry(
      store,
      { kind: 'style', key: 'x', text: 'style' },
      '2026-06-27T01:00:00.000Z',
    );
    expect(store.entries).toHaveLength(2);
  });

  it('is pure — the input store is not mutated', () => {
    const before = emptyMemoryStore();
    upsertMemoryEntry(
      before,
      { kind: 'repo-fact', key: 'x', text: 'y' },
      '2026-06-27T01:00:00.000Z',
    );
    expect(before.entries).toHaveLength(0);
  });
});

describe('composeMemorySection', () => {
  it('returns empty string for no entries', () => {
    expect(composeMemorySection([])).toBe('');
  });

  it('groups by kind, freshest first, with an advisory frame', () => {
    const section = composeMemorySection([
      entry({
        key: 'a',
        kind: 'repo-fact',
        text: 'auth in src/auth',
        updated_at: '2026-06-27T03:00:00.000Z',
      }),
      entry({
        key: 'b',
        kind: 'decision',
        text: 'use postgres',
        updated_at: '2026-06-27T02:00:00.000Z',
      }),
      entry({
        key: 'c',
        kind: 'recurring-failure',
        text: 'forgot to await flush',
        updated_at: '2026-06-27T01:00:00.000Z',
      }),
    ]);
    expect(section).toContain('## Codebase memory');
    expect(section).toContain('Advisory, not ground truth');
    expect(section).toContain('### Repo facts');
    expect(section).toContain('### Decisions');
    expect(section).toContain('### Recurring failures to avoid');
    expect(section).toContain('auth in src/auth');
  });

  it('includes source provenance when present', () => {
    const section = composeMemorySection([
      entry({ key: 'a', text: 'x', sources: ['src/auth/login.ts'] }),
    ]);
    expect(section).toContain('(src/auth/login.ts)');
  });

  it('caps to maxEntries', () => {
    const many = Array.from({ length: MAX_MEMORY_ENTRIES + 10 }, (_, i) =>
      entry({
        key: `k${i}`,
        text: `fact ${i}`,
        updated_at: `2026-06-27T00:00:${String(i).padStart(2, '0')}.000Z`,
      }),
    );
    const section = composeMemorySection(many);
    const bulletCount = (section.match(/^- /gm) ?? []).length;
    expect(bulletCount).toBeLessThanOrEqual(MAX_MEMORY_ENTRIES);
  });

  it('respects the character budget', () => {
    const long = 'x'.repeat(500);
    const many = Array.from({ length: 20 }, (_, i) =>
      entry({
        key: `k${i}`,
        text: `${long}-${i}`,
        updated_at: `2026-06-27T00:00:${String(i).padStart(2, '0')}.000Z`,
      }),
    );
    const section = composeMemorySection(many, { charBudget: 1200 });
    // The first (freshest) entry always lands; total stays near the budget.
    expect(section.length).toBeLessThan(1200 + 500 + 400);
    const bulletCount = (section.match(/^- /gm) ?? []).length;
    expect(bulletCount).toBeGreaterThanOrEqual(1);
    expect(bulletCount).toBeLessThan(20);
  });

  it('uses the documented default budgets', () => {
    expect(MEMORY_SECTION_CHAR_BUDGET).toBeGreaterThan(0);
    expect(MAX_MEMORY_ENTRIES).toBeGreaterThan(0);
  });
});

describe('loadCodebaseMemory / recordCodebaseMemory (round trip)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-mem-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('returns an empty store when nothing is on disk', () => {
    expect(loadCodebaseMemory(projectRoot)).toEqual(emptyMemoryStore());
  });

  it('a fact recorded in one session is recalled in the next (persists to disk)', async () => {
    await recordCodebaseMemory(
      projectRoot,
      { kind: 'repo-fact', key: 'seam', text: 'the seam is runtime/scripts/context-seam.mjs' },
      '2026-06-27T01:00:00.000Z',
    );
    // Simulate a fresh session: a brand-new read of the on-disk store.
    const reloaded = loadCodebaseMemory(projectRoot);
    expect(reloaded.entries).toHaveLength(1);
    expect(reloaded.entries[0].text).toContain('context-seam.mjs');
    expect(existsSync(memoryStorePath(projectRoot))).toBe(true);
    expect(memoryStorePath(projectRoot)).toBe(join(projectRoot, PATHS.CODEBASE_MEMORY));
  });

  it('superseding a fact evolves it on disk, never duplicates', async () => {
    await recordCodebaseMemory(
      projectRoot,
      { kind: 'decision', key: 'db', text: 'sqlite' },
      '2026-06-27T01:00:00.000Z',
    );
    await recordCodebaseMemory(
      projectRoot,
      { kind: 'decision', key: 'db', text: 'postgres' },
      '2026-06-27T02:00:00.000Z',
    );
    const reloaded = loadCodebaseMemory(projectRoot);
    expect(reloaded.entries).toHaveLength(1);
    expect(reloaded.entries[0].text).toBe('postgres');
  });

  it('degrades to an empty store on a corrupt file (never throws)', () => {
    mkdirSync(dirname(memoryStorePath(projectRoot)), { recursive: true });
    writeFileSync(memoryStorePath(projectRoot), 'not json{');
    expect(loadCodebaseMemory(projectRoot)).toEqual(emptyMemoryStore());
  });

  it('drops malformed entries on load', () => {
    mkdirSync(dirname(memoryStorePath(projectRoot)), { recursive: true });
    writeFileSync(
      memoryStorePath(projectRoot),
      JSON.stringify({
        version: 1,
        entries: [{ kind: 'repo-fact', key: 'ok', text: 't', updated_at: 'now' }, { junk: true }],
      }),
    );
    const loaded = loadCodebaseMemory(projectRoot);
    expect(loaded.entries).toHaveLength(1);
    expect(loaded.entries[0].key).toBe('ok');
  });
});

describe('gatherCodebaseMemory', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-mem-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('emits nothing when the store is empty (disabled/cold-start == today)', () => {
    expect(gatherCodebaseMemory(projectRoot)).toBe('');
  });

  it('emits the composed section once facts exist', async () => {
    await recordCodebaseMemory(
      projectRoot,
      { kind: 'style', key: 'dash', text: 'no em dashes in copy' },
      '2026-06-27T01:00:00.000Z',
    );
    const section = gatherCodebaseMemory(projectRoot);
    expect(section).toContain('## Codebase memory');
    expect(section).toContain('no em dashes in copy');
  });
});
