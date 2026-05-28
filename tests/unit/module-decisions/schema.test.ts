import { describe, expect, it } from 'vitest';

import {
  assertTransition,
  canTransition,
  formatDecisionId,
  isExpired,
  isValidDecisionId,
  isValidSlug,
  levenshtein,
  normaliseSlug,
  parseDecisionId,
  ttlExpiresAt,
  type ModuleDecision,
} from '@/module-decisions/schema.js';

function makeDecision(overrides: Partial<ModuleDecision> = {}): ModuleDecision {
  return {
    id: 'MD-0001',
    state: 'proposed',
    proposed_slug: 'payments',
    proposed_name: 'Payments',
    proposed_layer: null,
    proposed_features: [],
    source_of_decision: {
      type: 'pasted-ticket',
      prompt_excerpt: 'foo',
      detected_at: '2026-05-28T00:00:00.000Z',
    },
    confidence: 'medium',
    reasoning: '',
    disposition: { collision_with: null, alternatives_offered: [] },
    created_at: '2026-05-28T00:00:00.000Z',
    updated_at: '2026-05-28T00:00:00.000Z',
    expires_at: '2026-06-04T00:00:00.000Z',
    approved_by: null,
    applied_to_map_at: null,
    applied_to_map_commit: null,
    events_log_ref: null,
    ...overrides,
  };
}

describe('module-decisions/schema', () => {
  describe('id helpers', () => {
    it('formats and parses MD-XXXX ids round-trip', () => {
      expect(formatDecisionId(1)).toBe('MD-0001');
      expect(formatDecisionId(9999)).toBe('MD-9999');
      expect(formatDecisionId(12345)).toBe('MD-12345');
      expect(parseDecisionId('MD-0042')).toBe(42);
    });

    it('rejects invalid ordinals and ids', () => {
      expect(() => formatDecisionId(0)).toThrow();
      expect(() => formatDecisionId(-1)).toThrow();
      expect(() => parseDecisionId('foo')).toThrow();
      expect(() => parseDecisionId('MD-12')).toThrow();
      expect(isValidDecisionId('MD-0001')).toBe(true);
      expect(isValidDecisionId('md-0001')).toBe(false);
      expect(isValidDecisionId('MD-1')).toBe(false);
    });
  });

  describe('slug helpers', () => {
    it.each([
      ['payments', true],
      ['my-module', true],
      ['module-1', true],
      ['Module', false],
      ['my_module', false],
      ['', false],
      ['-leading', false],
      ['trailing-', false],
    ])('isValidSlug(%s) === %s', (input, expected) => {
      expect(isValidSlug(input)).toBe(expected);
    });

    it.each([
      ['Payments', 'payments'],
      ['My Module Name', 'my-module-name'],
      ['  spaced  ', 'spaced'],
      ['Mixed_Case-Stuff', 'mixed-case-stuff'],
      ['---weird---', 'weird'],
    ])('normaliseSlug(%s) === %s', (input, expected) => {
      expect(normaliseSlug(input)).toBe(expected);
    });

    it('normaliseSlug returns null for empty / all-punctuation input', () => {
      expect(normaliseSlug('')).toBeNull();
      expect(normaliseSlug('   ')).toBeNull();
      expect(normaliseSlug('---')).toBeNull();
    });
  });

  describe('levenshtein', () => {
    it('returns 0 for identical strings', () => {
      expect(levenshtein('payments', 'payments')).toBe(0);
    });

    it('catches near-collisions (distance ≤ 2)', () => {
      expect(levenshtein('payment', 'payments')).toBe(1);
      expect(levenshtein('payments', 'paymant')).toBe(2);
    });

    it('returns max+1 for distance beyond bound', () => {
      expect(levenshtein('cat', 'elephant', 2)).toBe(3);
    });

    it('handles empty strings', () => {
      expect(levenshtein('', 'abc')).toBe(3);
      expect(levenshtein('abc', '')).toBe(3);
      expect(levenshtein('', '')).toBe(0);
    });
  });

  describe('state machine', () => {
    it('allows draft → proposed → accepted', () => {
      expect(canTransition('draft', 'proposed')).toBe(true);
      expect(canTransition('proposed', 'accepted')).toBe(true);
    });

    it('disallows skipping states or reversing terminal ones', () => {
      expect(canTransition('draft', 'accepted')).toBe(false);
      expect(canTransition('accepted', 'rejected')).toBe(false);
      expect(canTransition('rejected', 'proposed')).toBe(false);
      expect(canTransition('expired', 'accepted')).toBe(false);
    });

    it('accepted → superseded is the only transition out of accepted', () => {
      expect(canTransition('accepted', 'superseded')).toBe(true);
      expect(canTransition('accepted', 'expired')).toBe(false);
    });

    it('assertTransition throws on illegal transitions', () => {
      expect(() => assertTransition('proposed', 'accepted')).not.toThrow();
      expect(() => assertTransition('rejected', 'accepted')).toThrow(/Illegal MD state/);
    });
  });

  describe('ttl + expiry', () => {
    it('ttlExpiresAt defaults to 7 days', () => {
      const created = new Date('2026-05-28T00:00:00.000Z');
      expect(ttlExpiresAt(created)).toBe('2026-06-04T00:00:00.000Z');
    });

    it('honours custom day count', () => {
      const created = new Date('2026-05-28T00:00:00.000Z');
      expect(ttlExpiresAt(created, 14)).toBe('2026-06-11T00:00:00.000Z');
    });

    it('isExpired only true for proposed past expires_at', () => {
      const d = makeDecision();
      expect(isExpired(d, new Date('2026-05-29T00:00:00.000Z'))).toBe(false);
      expect(isExpired(d, new Date('2026-07-01T00:00:00.000Z'))).toBe(true);
      const accepted = makeDecision({ state: 'accepted' });
      expect(isExpired(accepted, new Date('2026-07-01T00:00:00.000Z'))).toBe(false);
    });
  });
});
