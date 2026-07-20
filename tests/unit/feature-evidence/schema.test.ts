import { describe, expect, it } from 'vitest';

import { buildFeatureRecord, buildPlanRecord } from '@/feature-evidence/mint.js';
import {
  formatValidationError,
  validateFeatureRecord,
  validatePlanRecord,
} from '@/feature-evidence/schema.js';

const ULID = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const clock = () => new Date('2026-07-09T00:00:00.000Z');

function feature() {
  return buildFeatureRecord({
    issue: '339',
    title: 't',
    slug: 's',
    ulid: ULID,
    session_first_seen: 'ses_1',
    adapter: 'claude-code',
    now: clock,
  });
}

function plan() {
  return buildPlanRecord({
    issue: null,
    title: 't',
    slug: 's',
    ulid: ULID,
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
      issue: null,
      title: 't',
      slug: 's',
      ulid: ULID,
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
      issue: null,
      title: 't',
      slug: 's',
      ulid: ULID,
      summary: 'x',
      steps: [{ id: 'S1', description: 'a step with no verdict' }],
      now: clock,
    });
    expect(validatePlanRecord(record)).toEqual([]);
  });
});

describe('formatValidationError', () => {
  it('renders the instance path and message, with fallbacks', () => {
    expect(formatValidationError({ instancePath: '/status', message: 'bad' })).toBe('/status bad');
    expect(formatValidationError({})).toBe('(root) invalid');
  });
});
