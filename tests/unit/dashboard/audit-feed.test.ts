import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readAuditFeed } from '@/dashboard/audit-feed.js';

function writeLog(root: string, lines: string[]): void {
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad/audit.log'), `${lines.join('\n')}\n`);
}

describe('readAuditFeed', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-audit-feed-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns an empty feed when the log does not exist', () => {
    expect(readAuditFeed(root)).toEqual({ entries: [], nextCursor: null, total: 0 });
  });

  it('returns an empty feed for a blank log file', () => {
    writeLog(root, ['', '  ']);
    expect(readAuditFeed(root)).toEqual({ entries: [], nextCursor: null, total: 0 });
  });

  it('parses canonical lines newest first, including the dashboard actor', () => {
    writeLog(root, [
      '[2026-06-01T10:00:00.000Z] INFO rag-enabled provider="local" model="MiniLM"',
      '[2026-06-02T11:00:00.000Z] INFO dashboard.ops.doctor actor="dashboard" job="op-doctor-1" status="done"',
    ]);

    const feed = readAuditFeed(root);
    expect(feed.total).toBe(2);
    expect(feed.nextCursor).toBeNull();
    expect(feed.entries[0]).toEqual({
      ts: '2026-06-02T11:00:00.000Z',
      level: 'INFO',
      action: 'dashboard.ops.doctor',
      actor: 'dashboard',
      raw: '[2026-06-02T11:00:00.000Z] INFO dashboard.ops.doctor actor="dashboard" job="op-doctor-1" status="done"',
    });
    expect(feed.entries[1]).toEqual({
      ts: '2026-06-01T10:00:00.000Z',
      level: 'INFO',
      action: 'rag-enabled',
      actor: null,
      raw: '[2026-06-01T10:00:00.000Z] INFO rag-enabled provider="local" model="MiniLM"',
    });
  });

  it('parses a fieldless canonical line', () => {
    writeLog(root, ['[2026-06-03T08:00:00.000Z] WARN rag-fallback']);
    expect(readAuditFeed(root).entries[0]).toEqual({
      ts: '2026-06-03T08:00:00.000Z',
      level: 'WARN',
      action: 'rag-fallback',
      actor: null,
      raw: '[2026-06-03T08:00:00.000Z] WARN rag-fallback',
    });
  });

  it('keeps free-form lines as raw-only entries', () => {
    writeLog(root, ['something a tool scribbled without a timestamp']);
    expect(readAuditFeed(root).entries[0]).toEqual({
      ts: null,
      level: null,
      action: null,
      actor: null,
      raw: 'something a tool scribbled without a timestamp',
    });
  });

  it('pages from newest to oldest via the cursor', () => {
    writeLog(
      root,
      [1, 2, 3, 4, 5].map((n) => `[2026-06-0${n}T00:00:00.000Z] INFO action-${n}`),
    );

    const page1 = readAuditFeed(root, { limit: 2 });
    expect(page1.entries.map((entry) => entry.action)).toEqual(['action-5', 'action-4']);
    expect(page1.nextCursor).toBe(2);
    expect(page1.total).toBe(5);

    const page2 = readAuditFeed(root, { limit: 2, cursor: page1.nextCursor ?? 0 });
    expect(page2.entries.map((entry) => entry.action)).toEqual(['action-3', 'action-2']);
    expect(page2.nextCursor).toBe(4);

    const page3 = readAuditFeed(root, { limit: 2, cursor: page2.nextCursor ?? 0 });
    expect(page3.entries.map((entry) => entry.action)).toEqual(['action-1']);
    expect(page3.nextCursor).toBeNull();
  });

  it('returns an empty page for a cursor past the end', () => {
    writeLog(root, ['[2026-06-01T00:00:00.000Z] INFO only-line']);
    const feed = readAuditFeed(root, { cursor: 10 });
    expect(feed.entries).toEqual([]);
    expect(feed.nextCursor).toBeNull();
    expect(feed.total).toBe(1);
  });

  it('clamps the limit to the 1..1000 range and a negative cursor to 0', () => {
    writeLog(
      root,
      Array.from({ length: 1005 }, (_, i) => `[2026-06-01T00:00:00.000Z] INFO action-${i}`),
    );

    const capped = readAuditFeed(root, { limit: 5000 });
    expect(capped.entries).toHaveLength(1000);
    expect(capped.nextCursor).toBe(1000);

    const floored = readAuditFeed(root, { limit: 0, cursor: -3 });
    expect(floored.entries).toHaveLength(1);
    expect(floored.entries[0].action).toBe('action-1004');

    const defaulted = readAuditFeed(root, { limit: Number.NaN });
    expect(defaulted.entries).toHaveLength(200);
  });
});
