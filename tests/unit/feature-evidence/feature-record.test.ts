import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  featureRecordIsUntitled,
  readChangeConstants,
  readFeatureRecord,
  seedFeatureRecord,
  updateFeatureRecord,
  writeFeatureRecord,
} from '@/feature-evidence/feature-record.js';
import { buildFeatureRecord } from '@/feature-evidence/mint.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { validateFeatureRecord } from '@/feature-evidence/schema.js';
import { openFeatureChange, recordChangeConstants } from '@/feature-evidence/stage-ledger.js';

import { appendLegacyStageRow } from '../../shared/legacy-stage-row.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-feature-record-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const clock = () => new Date('2026-09-04T00:00:00.000Z');

/** A `feature.json` exactly as a pre-#581 writer left it (schema version 1, no branch keys). */
function legacyFeatureRecord(): Record<string, unknown> {
  return {
    schema_version: 1,
    doc_type: 'paqad.feature',
    issue: '511',
    title: 'Legacy title',
    slug: 'do-a-thing',
    ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    lane: null,
    status: 'active',
    spec_id: null,
    session_first_seen: 'ses_old',
    adapter: 'claude-code',
    content_hash: 'a'.repeat(64),
  };
}

function writeLegacyFeatureRecord(root: string): void {
  const abs = join(root, featureFilePath(DIR, 'feature'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(legacyFeatureRecord()));
}
const DIR = '511-do-a-thing-01JABCDEFGHJKMNPQRSTVWXYZ0';
const UNTITLED_DIR = 'change-01JABCDEFGHJKMNPQRSTVWXYZ1';

describe('seedFeatureRecord', () => {
  it('writes a valid feature.json from the dir-name identity + adapter/session', () => {
    const root = tempRoot();
    const record = seedFeatureRecord(root, DIR, {
      adapter: 'claude-code',
      sessionId: 'ses_1',
      lane: 'full',
      now: clock,
    });
    expect(record).not.toBeNull();
    expect(record!.issue).toBe('511');
    expect(record!.slug).toBe('do-a-thing');
    expect(record!.title).toBe('do-a-thing');
    expect(record!.lane).toBe('full');
    expect(record!.status).toBe('active');
    expect(record!.session_id).toBe('ses_1');
    expect(record!.change).toBe('01JABCDEFGHJKMNPQRSTVWXYZ0');
    expect(record!.recorded_at).toBe(clock().toISOString());
    expect(record!.adapter).toBe('claude-code');
    expect(validateFeatureRecord(record)).toEqual([]);
    // The file is on disk and re-readable.
    expect(readFeatureRecord(root, DIR)).toEqual(record);
  });

  it('is idempotent — a second seed returns the existing record and never re-mints', () => {
    const root = tempRoot();
    const first = seedFeatureRecord(root, DIR, { adapter: 'a', sessionId: 's1', now: clock });
    const again = seedFeatureRecord(root, DIR, { adapter: 'b', sessionId: 's2', now: clock });
    expect(again).toEqual(first);
    expect(readFeatureRecord(root, DIR)!.adapter).toBe('a');
  });

  it('returns null for a dir name that does not parse', () => {
    const root = tempRoot();
    expect(
      seedFeatureRecord(root, 'not a feature dir', { adapter: 'a', sessionId: 's' }),
    ).toBeNull();
  });
});

describe('updateFeatureRecord', () => {
  it('patches identity + status and re-stamps the content hash', () => {
    const root = tempRoot();
    const seeded = seedFeatureRecord(root, UNTITLED_DIR, {
      adapter: 'claude-code',
      sessionId: 's1',
      now: clock,
    })!;
    const later = () => new Date('2026-09-05T00:00:00.000Z');
    const updated = updateFeatureRecord(
      root,
      UNTITLED_DIR,
      { title: 'Real Title', status: 'done', spec_id: 'spec-511', lane: 'full', issue: 'PQD-9' },
      later,
    );
    expect(updated!.title).toBe('Real Title');
    expect(updated!.status).toBe('done');
    expect(updated!.spec_id).toBe('spec-511');
    expect(updated!.lane).toBe('full');
    expect(updated!.issue).toBe('PQD-9');
    expect(updated!.content_hash).not.toBe(seeded.content_hash);
    expect(updated!.created_at).toBe(seeded.created_at); // created_at is stable
    expect(updated!.updated_at).toBe('2026-09-05T00:00:00.000Z');
    expect(validateFeatureRecord(updated)).toEqual([]);
  });

  it('skips the write when nothing changes (no churn)', () => {
    const root = tempRoot();
    seedFeatureRecord(root, DIR, { adapter: 'a', sessionId: 's1', now: clock });
    const abs = join(root, featureFilePath(DIR, 'feature'));
    const before = readFileSync(abs, 'utf8');
    const unchanged = updateFeatureRecord(root, DIR, { status: 'active' }, () => new Date());
    expect(unchanged!.updated_at).toBe(readFeatureRecord(root, DIR)!.updated_at);
    expect(readFileSync(abs, 'utf8')).toBe(before);
  });

  it('rebuilds a minimal record when feature.json was never seeded', () => {
    const root = tempRoot();
    const updated = updateFeatureRecord(root, DIR, { status: 'done' }, clock);
    expect(updated).not.toBeNull();
    expect(updated!.issue).toBe('511');
    expect(updated!.status).toBe('done');
    expect(updated!.adapter).toBe('unknown');
    expect(validateFeatureRecord(updated)).toEqual([]);
  });

  it('returns null for an unparseable dir name', () => {
    const root = tempRoot();
    expect(updateFeatureRecord(root, 'nope', { status: 'done' })).toBeNull();
  });
});

describe('readFeatureRecord', () => {
  it('returns null for an absent file, and for a present-but-invalid one', () => {
    const root = tempRoot();
    expect(readFeatureRecord(root, DIR)).toBeNull();
    // Seed a valid record, then clobber it with an invalid shape.
    seedFeatureRecord(root, DIR, { adapter: 'a', sessionId: 's', now: clock });
    const abs = join(root, featureFilePath(DIR, 'feature'));
    writeFileSync(abs, '{"not":"a feature"}', 'utf8');
    expect(readFeatureRecord(root, DIR)).toBeNull();
  });
});

describe('writeFeatureRecord', () => {
  it('throws on a schema-invalid record', () => {
    const root = tempRoot();
    const bad = {
      ...buildFeatureRecord({
        issue: null,
        title: 'x',
        slug: 'x',
        change: '01JABCDEFGHJKMNPQRSTVWXYZ0',
        session_id: 's',
        adapter: 'a',
        now: clock,
      }),
      status: 'bogus' as never,
    };
    expect(() => writeFeatureRecord(root, DIR, bad)).toThrow(/Invalid feature\.json/);
  });
});

describe('best-effort write failures return null', () => {
  /** Block writes into the bundle by placing a FILE where the bundle DIR must be. */
  function blockBundleDir(root: string): void {
    const bundleDir = dirname(join(root, featureFilePath(DIR, 'feature')));
    mkdirSync(dirname(bundleDir), { recursive: true });
    writeFileSync(bundleDir, 'x'); // now mkdirSync(bundleDir) throws → the writer throws
  }

  it('seedFeatureRecord returns null when the bundle dir cannot be written', () => {
    const root = tempRoot();
    blockBundleDir(root);
    expect(seedFeatureRecord(root, DIR, { adapter: 'a', sessionId: 's' })).toBeNull();
  });

  it('updateFeatureRecord returns null when the bundle dir cannot be written', () => {
    const root = tempRoot();
    blockBundleDir(root);
    expect(updateFeatureRecord(root, DIR, { status: 'done' })).toBeNull();
  });
});

describe('featureRecordIsUntitled', () => {
  it('is true only for the placeholder title with no ticket', () => {
    const base = buildFeatureRecord({
      issue: null,
      title: 'change',
      slug: 'change',
      change: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      session_id: 's',
      adapter: 'a',
      now: clock,
    });
    expect(featureRecordIsUntitled(base)).toBe(true);
    expect(featureRecordIsUntitled({ ...base, title: 'Real' })).toBe(false);
    expect(featureRecordIsUntitled({ ...base, issue: '511' })).toBe(false);
  });
});

// Issue #581 (FR-6, AC-26) — the session constants live once, on feature.json.
describe('session constants on feature.json', () => {
  it('seeds branch and base_branch at open, null when unknown', () => {
    const root = tempRoot();
    const seeded = seedFeatureRecord(root, DIR, {
      adapter: 'claude-code',
      sessionId: 'ses_1',
      branch: 'feat/x',
      baseBranch: 'main',
      now: clock,
    });
    expect(seeded).toMatchObject({ branch: 'feat/x', base_branch: 'main' });
    expect(validateFeatureRecord(seeded)).toEqual([]);
    const bare = seedFeatureRecord(tempRoot(), DIR, { adapter: 'a', sessionId: 's', now: clock });
    expect(bare).toMatchObject({ branch: null, base_branch: null });
  });

  it('still validates a pre-#581 record with no branch keys (INV-8)', () => {
    expect(validateFeatureRecord(legacyFeatureRecord())).toEqual([]);
  });

  it('reads a pre-#581 record under the current names (INV-8)', () => {
    const root = tempRoot();
    writeLegacyFeatureRecord(root);
    expect(readFeatureRecord(root, DIR)).toMatchObject({
      schema_version: 1,
      change: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      session_id: 'ses_old',
      recorded_at: '2026-01-01T00:00:00.000Z',
      title: 'Legacy title',
      branch: null,
      base_branch: null,
    });
  });

  it('rewrites a pre-#581 record in the new shape on its next patch (INV-9)', () => {
    const root = tempRoot();
    writeLegacyFeatureRecord(root);
    updateFeatureRecord(root, DIR, { status: 'done' }, clock);
    const raw = JSON.parse(
      readFileSync(join(root, featureFilePath(DIR, 'feature')), 'utf8'),
    ) as Record<string, unknown>;
    expect(raw).toMatchObject({
      schema_version: 2,
      change: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      session_id: 'ses_old',
      recorded_at: '2026-01-01T00:00:00.000Z',
      updated_at: clock().toISOString(),
      status: 'done',
    });
    for (const key of ['ulid', 'session_first_seen', 'created_at']) {
      expect(raw).not.toHaveProperty(key);
    }
    expect(validateFeatureRecord(raw)).toEqual([]);
  });

  it('rejects a v2 record that still carries a v1 key', () => {
    const record = buildFeatureRecord({
      issue: null,
      title: 't',
      slug: 't',
      change: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      session_id: 's',
      adapter: 'a',
      now: clock,
    });
    expect(validateFeatureRecord({ ...record, ulid: record.change }).length).toBeGreaterThan(0);
  });

  it('updates the adapter and branch in place, the latest host winning', () => {
    const root = tempRoot();
    seedFeatureRecord(root, DIR, { adapter: 'claude-code', sessionId: 's', now: clock });
    const next = updateFeatureRecord(root, DIR, { adapter: 'codex-cli', branch: 'feat/y' }, clock);
    expect(next).toMatchObject({ adapter: 'codex-cli', branch: 'feat/y', base_branch: null });
    // Unchanged constants keep what was recorded.
    expect(updateFeatureRecord(root, DIR, { status: 'done' }, clock)).toMatchObject({
      adapter: 'codex-cli',
      branch: 'feat/y',
    });
  });

  it('recordChangeConstants never lets the backstop or an unresolved lane erase a fact', () => {
    const root = tempRoot();
    seedFeatureRecord(root, DIR, {
      adapter: 'codex-cli',
      sessionId: 's',
      lane: 'full',
      now: clock,
    });
    recordChangeConstants(root, DIR, { adapter: 'backstop', lane: null, branch: null }, clock);
    expect(readFeatureRecord(root, DIR)).toMatchObject({ adapter: 'codex-cli', lane: 'full' });
    recordChangeConstants(root, DIR, { lane: 'graduated', baseBranch: 'main' }, clock);
    expect(readFeatureRecord(root, DIR)).toMatchObject({ lane: 'graduated', base_branch: 'main' });
  });

  it('keeps one adapter equal to the latest host when a change moves hosts (AC-26)', () => {
    const root = tempRoot();
    const dir = openFeatureChange(root, 'ses_claude', {
      adapter: 'claude-code',
      lane: 'full',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ3',
      now: clock,
    });
    // The change continues on another host, in another session.
    openFeatureChange(root, 'ses_codex', {
      adapter: 'codex-cli',
      title: 'change',
      issue: null,
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ3',
      now: clock,
    });
    const record = readFeatureRecord(root, dir)!;
    expect(record.adapter).toBe('codex-cli');
    expect(record.lane).toBe('full');
    expect(record).toHaveProperty('branch');
    expect(record).toHaveProperty('base_branch');
  });
});

describe('readChangeConstants', () => {
  it('reads feature.json first', () => {
    const root = tempRoot();
    seedFeatureRecord(root, DIR, {
      adapter: 'codex-cli',
      sessionId: 's',
      lane: 'graduated',
      branch: 'feat/x',
      baseBranch: 'main',
      now: clock,
    });
    // A stale legacy open row never overrides what feature.json holds.
    appendLegacyStageRow(root, DIR, 's', { kind: 'open', adapter: 'claude-code', lane: 'fast' });
    expect(readChangeConstants(root, DIR)).toEqual({
      adapter: 'codex-cli',
      branch: 'feat/x',
      base_branch: 'main',
      lane: 'graduated',
    });
  });

  it('falls back field by field to a pre-#581 open row (INV-8)', () => {
    const root = tempRoot();
    // A pre-#581 record: a placeholder adapter, no lane, no branch keys.
    updateFeatureRecord(root, DIR, { status: 'active' }, clock);
    const rows = [
      appendLegacyStageRow(root, DIR, 's', {
        kind: 'open',
        adapter: 'claude-code',
        lane: 'full',
        branch: 'feat/old',
      }),
    ];
    expect(readChangeConstants(root, DIR, rows)).toEqual({
      adapter: 'claude-code',
      branch: 'feat/old',
      base_branch: null,
      lane: 'full',
    });
    expect(readChangeConstants(root, DIR)).toEqual(readChangeConstants(root, DIR, rows));
  });

  it('reads all-null for a bundle with neither a record nor an open row', () => {
    expect(readChangeConstants(tempRoot(), DIR)).toEqual({
      adapter: null,
      branch: null,
      base_branch: null,
      lane: null,
    });
  });
});
