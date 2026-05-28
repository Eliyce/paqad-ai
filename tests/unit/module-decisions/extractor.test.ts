import { describe, expect, it } from 'vitest';

import {
  candidatesNeedingDecision,
  extractCandidates,
} from '@/module-decisions/extractor.js';

describe('module-decisions/extractor', () => {
  const existing = ['cli-lifecycle', 'auth', 'payments'];

  it('picks up explicit "module:" inline marker', () => {
    const cands = extractCandidates({
      prompt: 'Please add the field to module: billing',
      existingSlugs: existing,
    });
    expect(cands).toHaveLength(1);
    expect(cands[0]?.slug).toBe('billing');
    expect(cands[0]?.kind).toBe('unknown');
    expect(cands[0]?.pattern).toBe('inline-module-slug');
  });

  it('picks up "new module <name>" pattern', () => {
    const cands = extractCandidates({
      prompt: 'We need a new module Stripe Connect for payouts.',
      existingSlugs: existing,
    });
    expect(cands.map((c) => c.slug)).toContain('stripe-connect');
  });

  it('picks up "in the <name> module" pattern', () => {
    const cands = extractCandidates({
      prompt: 'fix bug in the inventory module',
      existingSlugs: existing,
    });
    expect(cands.map((c) => c.slug)).toContain('inventory');
  });

  it('picks up ticket headers', () => {
    const cands = extractCandidates({
      prompt: 'JIRA-1234\nModule: Reporting\nDescription: ...',
      existingSlugs: existing,
    });
    expect(cands.map((c) => c.slug)).toContain('reporting');
  });

  it('flags exact match against existing slug', () => {
    const cands = extractCandidates({
      prompt: 'module: payments — add Stripe webhook',
      existingSlugs: existing,
    });
    const payments = cands.find((c) => c.slug === 'payments');
    expect(payments?.kind).toBe('exact-match');
    expect(payments?.collision_with).toBe('payments');
  });

  it('flags near-collision within Levenshtein 2', () => {
    const cands = extractCandidates({
      prompt: 'module: payment',
      existingSlugs: existing,
    });
    expect(cands).toHaveLength(1);
    expect(cands[0]?.kind).toBe('near-collision');
    expect(cands[0]?.collision_with).toBe('payments');
  });

  it('deduplicates the same slug across patterns', () => {
    const cands = extractCandidates({
      prompt: 'module: billing\nNew module billing should also exist',
      existingSlugs: existing,
    });
    expect(cands.filter((c) => c.slug === 'billing')).toHaveLength(1);
  });

  it('supports multiple distinct modules in one prompt', () => {
    const cands = extractCandidates({
      prompt: 'add fields to module: billing and module: invoicing',
      existingSlugs: existing,
    });
    expect(cands.map((c) => c.slug).sort()).toEqual(['billing', 'invoicing']);
  });

  it('returns empty for prompts with no module signals', () => {
    expect(
      extractCandidates({
        prompt: 'just rename this variable',
        existingSlugs: existing,
      }),
    ).toEqual([]);
  });

  it('ignores unparseable names (slug normalises to empty)', () => {
    expect(
      extractCandidates({
        prompt: 'module: ---',
        existingSlugs: existing,
      }),
    ).toEqual([]);
  });

  it('candidatesNeedingDecision filters out exact matches', () => {
    const cands = extractCandidates({
      prompt: 'module: payments and module: billing',
      existingSlugs: existing,
    });
    const needing = candidatesNeedingDecision(cands);
    expect(needing.map((c) => c.slug)).toEqual(['billing']);
  });

  it('respects custom near-collision distance bound', () => {
    const strict = extractCandidates({
      prompt: 'module: payment',
      existingSlugs: ['payments'],
      nearCollisionDistance: 0,
    });
    expect(strict[0]?.kind).toBe('unknown');
    expect(strict[0]?.collision_with).toBeNull();
  });
});
