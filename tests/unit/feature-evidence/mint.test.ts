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
    expect(minted.slug).toBe('fix-crash');
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
    expect(minted.dirName).toBe(`45-fix-crash-${ULID}`);
    expect(parseFeatureDirName(minted.dirName)).toEqual({
      issue: '45',
      slug: 'fix-crash',
      ulid: ULID,
    });
  });

  it('strips a leading # from an explicit github ref too', () => {
    expect(mintFeatureDirName({ title: 'x', issue: '#9', ulid: ULID }).issue).toBe('9');
  });

  it('treats a ref that empties out as no issue', () => {
    expect(mintFeatureDirName({ title: 'x', issue: '#', ulid: ULID }).issue).toBeNull();
  });

  // Issue #581 (AC-16, FR-13) — the ref appears once in the dir name.
  it('takes the detected ref out of the title before slugging (AC-16)', () => {
    expect(
      mintFeatureDirName({ title: 'PROJ-123 Checkout page cleanup', ulid: ULID }).dirName,
    ).toBe(`PROJ-123-checkout-page-cleanup-${ULID}`);
    expect(mintFeatureDirName({ title: 'fix PROJ-9: leak', ulid: ULID }).dirName).toBe(
      `PROJ-9-fix-leak-${ULID}`,
    );
    expect(mintFeatureDirName({ title: 'PROJ-9 - PROJ-9 twice', ulid: ULID }).slug).toBe('twice');
    expect(mintFeatureDirName({ title: 'fix(#403): back-fill', ulid: ULID }).dirName).toBe(
      `403-fix-back-fill-${ULID}`,
    );
  });

  it('strips an explicit issue from the title case-insensitively', () => {
    const minted = mintFeatureDirName({ title: 'proj-7: tidy up', issue: 'PROJ-7', ulid: ULID });
    expect(minted.dirName).toBe(`PROJ-7-tidy-up-${ULID}`);
    expect(mintFeatureDirName({ title: '#9 x', issue: '#9', ulid: ULID }).slug).toBe('x');
  });

  it('strips a bare-number issue only as #N or when it leads the title', () => {
    const lead = mintFeatureDirName({ title: '581 One evidence packet', issue: '581', ulid: ULID });
    expect(lead.dirName).toBe(`581-one-evidence-packet-${ULID}`);
    const wording = mintFeatureDirName({ title: 'Show 45 rows', issue: '45', ulid: ULID });
    expect(wording.slug).toBe('show-45-rows');
    // Part of a longer token is not the ref.
    expect(
      mintFeatureDirName({ title: 'PROJ-12 PROJ-123x', issue: 'PROJ-12', ulid: ULID }).slug,
    ).toBe('proj-123x');
  });

  it('keeps the whole title when it is nothing but the ref', () => {
    expect(mintFeatureDirName({ title: 'PROJ-5', ulid: ULID }).dirName).toBe(
      `PROJ-5-proj-5-${ULID}`,
    );
    expect(mintFeatureDirName({ title: '#12:', ulid: ULID }).slug).toBe('12');
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

  it('computeContentHash ignores the #581 recorded_at time field too', () => {
    expect(computeContentHash({ a: 1, recorded_at: 'y' })).toBe(computeContentHash({ a: 1 }));
    expect(computeContentHash({ a: 1 })).not.toBe(computeContentHash({ a: 2 }));
  });
});
