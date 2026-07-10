import { describe, expect, it } from 'vitest';

import {
  buildFeatureRecord,
  buildPlanRecord,
  computeContentHash,
  mintFeatureDirName,
} from '@/feature-evidence/mint.js';
import { parseFeatureDirName } from '@/feature-evidence/paths.js';
import { validateFeatureRecord, validatePlanRecord } from '@/feature-evidence/schema.js';

const ULID = '01JABCDEFGHJKMNPQRSTVWXYZ0';

describe('mintFeatureDirName', () => {
  it('mints a name from a title + explicit issue and parses back', () => {
    const minted = mintFeatureDirName({ title: 'Route first workflows', issue: '339', ulid: ULID });
    expect(minted.dirName).toBe(`339-route-first-workflows-${ULID}`);
    expect(parseFeatureDirName(minted.dirName)).toEqual({
      issue: '339',
      slug: 'route-first-workflows',
      ulid: ULID,
    });
  });

  it('detects a ticket ref from the title when issue is omitted', () => {
    const minted = mintFeatureDirName({ title: 'Fix PQD-42 crash', ulid: ULID });
    expect(minted.issue).toBe('PQD-42');
    expect(minted.slug).toBe('fix-pqd-42-crash');
  });

  it('emits no issue when issue is null even if the title has a ref', () => {
    const minted = mintFeatureDirName({ title: 'Fix #7 bug', issue: null, ulid: ULID });
    expect(minted.issue).toBeNull();
    expect(minted.dirName).toBe(`fix-7-bug-${ULID}`);
  });

  it('mints a real ULID when none is supplied', () => {
    const minted = mintFeatureDirName({ title: 'x', issue: null, ulidSeed: 1_700_000_000_000 });
    expect(minted.ulid).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(parseFeatureDirName(minted.dirName)).not.toBeNull();
  });

  it('strips a leading # from a detected github ref so the name parses back', () => {
    const minted = mintFeatureDirName({ title: 'Fix #45 crash', ulid: ULID });
    expect(minted.issue).toBe('45');
    expect(minted.dirName).toBe(`45-fix-45-crash-${ULID}`);
    expect(parseFeatureDirName(minted.dirName)).toEqual({
      issue: '45',
      slug: 'fix-45-crash',
      ulid: ULID,
    });
  });

  it('strips a leading # from an explicit github ref too', () => {
    expect(mintFeatureDirName({ title: 'x', issue: '#9', ulid: ULID }).issue).toBe('9');
  });

  it('treats a ref that empties out as no issue', () => {
    expect(mintFeatureDirName({ title: 'x', issue: '#', ulid: ULID }).issue).toBeNull();
  });

  it('detects no issue when the title has no ticket ref', () => {
    const minted = mintFeatureDirName({ title: 'just a plain title', ulid: ULID });
    expect(minted.issue).toBeNull();
    expect(minted.dirName).toBe(`just-a-plain-title-${ULID}`);
  });
});

describe('record builders', () => {
  const clock = () => new Date('2026-07-09T00:00:00.000Z');

  it('builds a valid feature.json with a stamped hash', () => {
    const record = buildFeatureRecord({
      issue: '339',
      title: 'Route first workflows',
      slug: 'route-first-workflows',
      ulid: ULID,
      session_first_seen: 'ses_1',
      adapter: 'claude-code',
      lane: 'full',
      now: clock,
    });
    expect(validateFeatureRecord(record)).toEqual([]);
    expect(record.status).toBe('active');
    expect(record.spec_id).toBeNull();
    expect(record.created_at).toBe('2026-07-09T00:00:00.000Z');
  });

  it('builds a valid plan.json with steps and risks', () => {
    const record = buildPlanRecord({
      issue: null,
      title: 'x',
      slug: 'x',
      ulid: ULID,
      summary: 'do the thing',
      steps: [{ id: 'S1', description: 'first', module: 'core' }],
      modules_touched: ['core'],
      decisions: ['D-01JABC'],
      risks: [{ description: 'r', mitigation: 'm' }],
      now: clock,
    });
    expect(validatePlanRecord(record)).toEqual([]);
    expect(record.steps).toHaveLength(1);
  });

  it('applies plan defaults for the optional collections', () => {
    const record = buildPlanRecord({
      issue: null,
      title: 'x',
      slug: 'x',
      ulid: ULID,
      summary: 's',
      now: clock,
    });
    expect(record.steps).toEqual([]);
    expect(record.modules_touched).toEqual([]);
    expect(record.decisions).toEqual([]);
    expect(record.risks).toEqual([]);
  });

  it('content_hash is stable across timestamps but changes with identity', () => {
    const base = {
      issue: '339' as const,
      title: 't',
      slug: 's',
      ulid: ULID,
      session_first_seen: 'ses_1',
      adapter: 'claude-code',
    };
    const a = buildFeatureRecord({ ...base, now: () => new Date('2026-01-01T00:00:00Z') });
    const b = buildFeatureRecord({ ...base, now: () => new Date('2027-01-01T00:00:00Z') });
    expect(a.content_hash).toBe(b.content_hash);
    const c = buildFeatureRecord({ ...base, title: 'different', now: clock });
    expect(c.content_hash).not.toBe(a.content_hash);
  });

  it('stamps a real clock when no `now` seam is passed', () => {
    const f = buildFeatureRecord({
      issue: null,
      title: 't',
      slug: 's',
      ulid: ULID,
      session_first_seen: 'ses_1',
      adapter: 'claude-code',
    });
    const p = buildPlanRecord({ issue: null, title: 't', slug: 's', ulid: ULID, summary: 'x' });
    expect(Date.parse(f.created_at)).not.toBeNaN();
    expect(Date.parse(p.created_at)).not.toBeNaN();
  });

  it('computeContentHash ignores only the volatile keys', () => {
    const h1 = computeContentHash({ a: 1, content_hash: 'x', created_at: 'y', updated_at: 'z' });
    const h2 = computeContentHash({
      a: 1,
      content_hash: 'DIFF',
      created_at: 'DIFF',
      updated_at: 'DIFF',
    });
    expect(h1).toBe(h2);
  });
});
