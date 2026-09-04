import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  featureRecordIsUntitled,
  readFeatureRecord,
  seedFeatureRecord,
  updateFeatureRecord,
  writeFeatureRecord,
} from '@/feature-evidence/feature-record.js';
import { buildFeatureRecord } from '@/feature-evidence/mint.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { validateFeatureRecord } from '@/feature-evidence/schema.js';

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
    expect(record!.session_first_seen).toBe('ses_1');
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
    expect(seedFeatureRecord(root, 'not a feature dir', { adapter: 'a', sessionId: 's' })).toBeNull();
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
      { title: 'Real Title', status: 'done', spec_id: 'spec-511' },
      later,
    );
    expect(updated!.title).toBe('Real Title');
    expect(updated!.status).toBe('done');
    expect(updated!.spec_id).toBe('spec-511');
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
    const bad = { ...buildFeatureRecord({
      issue: null,
      title: 'x',
      slug: 'x',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      session_first_seen: 's',
      adapter: 'a',
      now: clock,
    }), status: 'bogus' as never };
    expect(() => writeFeatureRecord(root, DIR, bad)).toThrow(/Invalid feature\.json/);
  });
});

describe('featureRecordIsUntitled', () => {
  it('is true only for the placeholder title with no ticket', () => {
    const base = buildFeatureRecord({
      issue: null,
      title: 'change',
      slug: 'change',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      session_first_seen: 's',
      adapter: 'a',
      now: clock,
    });
    expect(featureRecordIsUntitled(base)).toBe(true);
    expect(featureRecordIsUntitled({ ...base, title: 'Real' })).toBe(false);
    expect(featureRecordIsUntitled({ ...base, issue: '511' })).toBe(false);
  });
});
