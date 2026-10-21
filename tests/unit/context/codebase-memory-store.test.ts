import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  composeMemorySection,
  emptyMemoryStore,
  loadCodebaseMemory,
  memoryStorePath,
  upsertMemoryEntry,
  type CodebaseMemoryEntry,
} from '@/context/codebase-memory.js';

describe('codebase memory store', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-memory-store-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function store(contents: string): void {
    const path = memoryStorePath(root);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }

  it.each([
    ['not JSON', '{nope'],
    ['a bare value', '7'],
    ['null', 'null'],
    ['no entries list', '{"entries":{}}'],
  ])('reads a store that is %s as empty', (_label, contents) => {
    store(contents);
    expect(loadCodebaseMemory(root)).toEqual(emptyMemoryStore());
  });

  it('keeps only well-formed entries', () => {
    store(
      JSON.stringify({
        entries: [
          null,
          'text',
          { kind: 'repo-fact', key: '', text: 't', updated_at: 'x' },
          { kind: 'gossip', key: 'k', text: 't', updated_at: 'x' },
          { kind: 'style', key: 'k', text: 't', updated_at: 'x', id: 'style:k' },
        ],
      }),
    );
    expect(loadCodebaseMemory(root).entries).toEqual([
      { kind: 'style', key: 'k', text: 't', updated_at: 'x', id: 'style:k' },
    ]);
  });

  it('leaves out an empty sources list when it records an entry', () => {
    const next = upsertMemoryEntry(
      emptyMemoryStore(),
      { kind: 'decision', key: 'db', text: ' Postgres ', sources: [] },
      '2026-01-01',
    );
    expect(next.entries[0]).not.toHaveProperty('sources');
    expect(next.entries[0]?.text).toBe('Postgres');
  });

  it('orders equally recent entries by id and drops everything when the first line is too long', () => {
    const entry = (id: string, text: string): CodebaseMemoryEntry => ({
      id,
      kind: 'repo-fact',
      key: id,
      text,
      updated_at: '2026-01-01',
    });
    expect(composeMemorySection([entry('b', 'second'), entry('a', 'first')])).toContain(
      '- first\n- second',
    );
    expect(composeMemorySection([entry('a', 'x'.repeat(50))], { charBudget: 10 })).toContain(
      'x'.repeat(50),
    );
    expect(composeMemorySection([entry('a', 'x')], { maxEntries: 0 })).toBe('');
    expect(composeMemorySection([entry('a', 'x')], { charBudget: 0 })).toBe('');
  });
});
