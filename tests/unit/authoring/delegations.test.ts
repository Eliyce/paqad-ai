import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DELEGATION_STALE_LOCK_MS,
  DELEGATIONS_LEDGER,
  forEachDelegation,
  lastDelegatedByAgent,
  pruneDelegations,
} from '@/authoring/delegations.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(lines: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-delegations-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad/ledger/authoring'), { recursive: true });
  writeFileSync(join(root, DELEGATIONS_LEDGER), `${lines.join('\n')}\n`);
  return root;
}

const row = (agent: string, at: string) =>
  JSON.stringify({
    agent,
    request_id: null,
    session_id: null,
    at,
    tokens: 10,
    duration_ms: 5,
    status: 'completed',
  });

describe('the delegation ledger reader', () => {
  it('AC-11: reads every valid row and keeps the latest delegation per agent', () => {
    const root = project([
      row('a', '2026-10-01T00:00:00.000Z'),
      'not json',
      JSON.stringify({ at: '2026-10-02T00:00:00.000Z' }),
      row('a', '2026-10-03T00:00:00.000Z'),
      row('b', '2026-09-01T00:00:00.000Z'),
    ]);
    const seen: string[] = [];
    forEachDelegation(root, (entry) => seen.push(entry.agent));
    expect(seen).toEqual(['a', 'a', 'b']);
    expect([...lastDelegatedByAgent(root)]).toEqual([
      ['a', '2026-10-03T00:00:00.000Z'],
      ['b', '2026-09-01T00:00:00.000Z'],
    ]);
  });

  it('a missing ledger reads as empty and prunes nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-delegations-'));
    roots.push(root);
    expect(lastDelegatedByAgent(root).size).toBe(0);
    expect(pruneDelegations(root, new Date(), 30)).toBe(0);
  });

  it('prunes rows older than twice the dark window only when forced or over the size bound', () => {
    const root = project([
      row('a', '2026-10-30T00:00:00.000Z'),
      row('b', '2026-01-01T00:00:00.000Z'),
    ]);
    const now = new Date('2026-10-31T00:00:00.000Z');
    expect(pruneDelegations(root, now, 30)).toBe(0);
    expect(pruneDelegations(root, now, 30, true)).toBe(1);
    expect(readFileSync(join(root, DELEGATIONS_LEDGER), 'utf8')).toContain('"agent":"a"');
    expect(pruneDelegations(root, new Date('2027-10-31T00:00:00.000Z'), 30, true)).toBe(1);
    expect(readFileSync(join(root, DELEGATIONS_LEDGER), 'utf8')).toBe('');
  });

  it('INV-9: a prune another run holds the lock for leaves the ledger as it is', () => {
    const root = project([
      row('a', '2026-10-30T00:00:00.000Z'),
      row('b', '2026-01-01T00:00:00.000Z'),
    ]);
    const path = join(root, DELEGATIONS_LEDGER);
    writeFileSync(`${path}.lock`, '');
    const before = readFileSync(path, 'utf8');
    expect(pruneDelegations(root, new Date('2026-10-31T00:00:00.000Z'), 30, true)).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(existsSync(`${path}.lock`)).toBe(true);
  });

  it('INV-9: rows a hook appended while a compaction was cut short are read and kept', () => {
    const root = project([
      row('a', '2026-10-30T00:00:00.000Z'),
      row('b', '2026-01-01T00:00:00.000Z'),
    ]);
    const path = join(root, DELEGATIONS_LEDGER);
    renameSync(path, `${path}.compacting`);
    writeFileSync(path, `${row('c', '2026-10-31T00:00:00.000Z')}\n`);
    expect([...lastDelegatedByAgent(root).keys()].sort()).toEqual(['a', 'b', 'c']);
    expect(pruneDelegations(root, new Date('2026-10-31T00:00:00.000Z'), 30)).toBe(1);
    expect(existsSync(`${path}.compacting`)).toBe(false);
    expect(existsSync(`${path}.lock`)).toBe(false);
    expect([...lastDelegatedByAgent(root).keys()].sort()).toEqual(['a', 'c']);
  });
});

describe('the delegation ledger edges', () => {
  it('AC-11: reads a last row with no trailing newline', () => {
    const root = project([]);
    writeFileSync(
      join(root, DELEGATIONS_LEDGER),
      `${row('a', '2026-10-01T00:00:00.000Z')}\n${row('b', '2026-10-02T00:00:00.000Z')}`,
    );
    expect([...lastDelegatedByAgent(root).keys()].sort()).toEqual(['a', 'b']);
  });

  it('INV-9: a lock older than the stale bound is cleared so the next prune can run', () => {
    const root = project([row('b', '2026-01-01T00:00:00.000Z')]);
    const path = join(root, DELEGATIONS_LEDGER);
    writeFileSync(`${path}.lock`, '');
    const later = new Date(Date.now() + DELEGATION_STALE_LOCK_MS + 60_000);
    expect(pruneDelegations(root, later, 30, true)).toBe(0);
    expect(existsSync(`${path}.lock`)).toBe(false);
    expect(pruneDelegations(root, later, 30, true)).toBe(1);
  });

  it('INV-9: a cut-short compaction with the ledger gone keeps every recent row', () => {
    const root = project([row('a', '2026-10-30T00:00:00.000Z')]);
    const path = join(root, DELEGATIONS_LEDGER);
    renameSync(path, `${path}.compacting`);
    expect(pruneDelegations(root, new Date('2026-10-31T00:00:00.000Z'), 30)).toBe(0);
    expect([...lastDelegatedByAgent(root).keys()]).toEqual(['a']);
  });
});
