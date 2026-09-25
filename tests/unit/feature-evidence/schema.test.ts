import { describe, expect, it } from 'vitest';

import { buildFeatureRecord, buildPlanRecord, buildReviewRecord } from '@/feature-evidence/mint.js';
import {
  formatValidationError,
  validateEnvelopeHeader,
  validateFeatureRecord,
  validatePlanRecord,
  validateReviewRecord,
} from '@/feature-evidence/schema.js';

const ULID = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const clock = () => new Date('2026-07-09T00:00:00.000Z');

function feature() {
  return buildFeatureRecord({
    issue: '339',
    title: 't',
    slug: 's',
    change: ULID,
    session_id: 'ses_1',
    adapter: 'claude-code',
    now: clock,
  });
}

function plan() {
  return buildPlanRecord({
    change: ULID,
    session_id: 'ses_1',
    summary: 'x',
    now: clock,
  });
}

describe('validateFeatureRecord', () => {
  it('accepts a built record', () => {
    expect(validateFeatureRecord(feature())).toEqual([]);
  });

  it('rejects an unknown key', () => {
    const errors = validateFeatureRecord({ ...feature(), sneaky: true });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).toMatch(/additional/i);
  });

  it('rejects a bad status enum and a missing required field', () => {
    expect(validateFeatureRecord({ ...feature(), status: 'nope' }).length).toBeGreaterThan(0);
    const { title, ...noTitle } = feature();
    void title;
    expect(validateFeatureRecord(noTitle).length).toBeGreaterThan(0);
  });
});

describe('validatePlanRecord', () => {
  it('accepts a built record', () => {
    expect(validatePlanRecord(plan())).toEqual([]);
  });

  it('rejects an unknown key and a malformed step', () => {
    expect(validatePlanRecord({ ...plan(), sneaky: 1 }).length).toBeGreaterThan(0);
    expect(validatePlanRecord({ ...plan(), steps: [{ id: 'S1' }] }).length).toBeGreaterThan(0);
  });

  it('carries a diff-minimizer step classification through the builder (issue #359)', () => {
    const record = buildPlanRecord({
      change: ULID,
      session_id: 'ses_1',
      summary: 'x',
      steps: [
        { id: 'S1', description: 'satisfy an AC', classification: 'ac-satisfying' },
        { id: 'S2', description: 'the setup it needs', classification: 'necessary-setup' },
      ],
      now: clock,
    });
    expect(validatePlanRecord(record)).toEqual([]);
    expect(record.steps.map((step) => step.classification)).toEqual([
      'ac-satisfying',
      'necessary-setup',
    ]);
  });

  it('rejects an unknown step classification (issue #359)', () => {
    expect(
      validatePlanRecord({
        ...plan(),
        steps: [{ id: 'S1', description: 'x', classification: 'gold-plating' }],
      }).length,
    ).toBeGreaterThan(0);
  });

  it('accepts a step with no classification — the field is optional (INV-3)', () => {
    const record = buildPlanRecord({
      change: ULID,
      session_id: 'ses_1',
      summary: 'x',
      steps: [{ id: 'S1', description: 'a step with no verdict' }],
      now: clock,
    });
    expect(validatePlanRecord(record)).toEqual([]);
  });
});

// Issue #581 — every document schema composes the envelope fragment and still reads v1.
describe('versioned document schemas (issue #581)', () => {
  const legacyPlan = {
    schema_version: 1,
    doc_type: 'paqad.plan',
    issue: '339',
    title: 't',
    slug: 's',
    ulid: ULID,
    summary: 'x',
    steps: [],
    modules_touched: [],
    decisions: [],
    risks: [],
    created_at: 'a',
    updated_at: 'a',
    content_hash: 'h',
  };
  const legacyReview = {
    schema_version: 1,
    doc_type: 'paqad.review',
    issue: null,
    title: 't',
    slug: 's',
    ulid: ULID,
    summary: 'x',
    verdict: 'safe-to-merge',
    findings: [],
    checked: [],
    rollback: 'revert',
    created_at: 'a',
    updated_at: 'a',
    content_hash: 'h',
  };
  function review() {
    return buildReviewRecord({
      change: ULID,
      session_id: 'ses_1',
      summary: 'x',
      verdict: 'inconclusive',
      rollback: 'revert',
      now: clock,
    });
  }

  it('accepts a pre-#581 plan and review (INV-8)', () => {
    expect(validatePlanRecord(legacyPlan)).toEqual([]);
    expect(validateReviewRecord(legacyReview)).toEqual([]);
  });

  it('accepts a built v2 review and rejects the identity keys on it', () => {
    expect(validateReviewRecord(review())).toEqual([]);
    expect(validateReviewRecord({ ...review(), title: 't' }).length).toBeGreaterThan(0);
    expect(validatePlanRecord({ ...plan(), slug: 's' }).length).toBeGreaterThan(0);
  });

  it('rejects a v2 document with a malformed header', () => {
    expect(validatePlanRecord({ ...plan(), change: 'not-a-ulid' }).length).toBeGreaterThan(0);
    expect(validatePlanRecord({ ...plan(), content_hash: 'H' }).length).toBeGreaterThan(0);
    const noSession: Record<string, unknown> = { ...review() };
    delete noSession.session_id;
    expect(validateReviewRecord(noSession).length).toBeGreaterThan(0);
  });

  it('checks a v1-versioned document only against the v1 shape', () => {
    // A v1 plan that dropped a v1-only key is invalid, even though v2 never had it.
    const noUlid: Record<string, unknown> = { ...legacyPlan };
    delete noUlid.ulid;
    expect(validatePlanRecord(noUlid).length).toBeGreaterThan(0);
  });

  it('every built document passes the header-only envelope check', () => {
    for (const doc of [feature(), plan(), review()]) {
      expect(validateEnvelopeHeader(doc)).toEqual([]);
    }
  });
});

describe('formatValidationError', () => {
  it('renders the instance path and message, with fallbacks', () => {
    expect(formatValidationError({ instancePath: '/status', message: 'bad' })).toBe('/status bad');
    expect(formatValidationError({})).toBe('(root) invalid');
  });
});
