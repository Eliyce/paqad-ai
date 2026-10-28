import { describe, expect, it } from 'vitest';

import { inferAttribution } from '@/module-decisions/inferencer.js';
import type { ModuleMap, ModuleMapEntry } from '@/onboarding/registry-generator.js';

function mod(partial: Partial<ModuleMapEntry> & { slug: string; name: string }): ModuleMapEntry {
  return {
    name: partial.name,
    slug: partial.slug,
    auto_update_module_name: false,
    derivation: partial.derivation ?? 'user',
    confidence: partial.confidence ?? 'medium',
    source_paths: partial.source_paths ?? [],
    evidence: partial.evidence ?? {},
    features: partial.features ?? [],
  };
}

function map(modules: ModuleMapEntry[]): ModuleMap {
  return {
    version: 1,
    last_updated_at: '2026-05-28T00:00:00Z',
    domain_glossary: { preferred_terms: [], synonyms: {}, notes: '' },
    modules,
  };
}

describe('module-decisions/inferencer', () => {
  it('returns only the fallback choices when no module map is present', () => {
    const result = inferAttribution({ prompt: 'add stripe webhook', moduleMap: null });
    expect(result.confident).toBe(false);
    expect(result.choices.map((c) => c.kind)).toEqual(['new-module-fallback', 'no-attribution']);
  });

  it('ranks the existing module that shares the most tokens first', () => {
    const m = map([
      mod({
        slug: 'payments',
        name: 'Payments',
        source_paths: ['src/payments/**', 'src/stripe/**'],
        features: [
          {
            name: 'Stripe Webhooks',
            slug: 'stripe-webhooks',
            auto_update_feature_name: false,
            derivation: 'user',
            confidence: 'high',
            source_paths: [],
          },
        ],
      }),
      mod({
        slug: 'auth',
        name: 'Auth',
        source_paths: ['src/auth/**'],
        features: [],
      }),
    ]);
    const result = inferAttribution({
      prompt: 'Add a new Stripe webhook handler for refund events',
      moduleMap: m,
    });
    expect(result.choices[0]?.kind).toBe('extend-existing');
    expect(result.choices[0]?.slug).toBe('payments');
    expect(result.choices[0]?.score).toBe(0.2);
    expect(result.confident).toBe(false);
    expect(result.choices[0]?.matched_tokens).toContain('stripe');
  });

  it('marks not-confident when no existing module clears the floor', () => {
    const m = map([mod({ slug: 'auth', name: 'Auth', source_paths: ['src/auth/**'] })]);
    const result = inferAttribution({
      prompt: 'tweak invoice rendering for euro currencies',
      moduleMap: m,
    });
    expect(result.confident).toBe(false);
    const kinds = result.choices.map((c) => c.kind);
    expect(kinds).toContain('new-module-fallback');
    expect(kinds).toContain('no-attribution');
  });

  it('caps existing-module choices to maxChoices', () => {
    const m = map([
      mod({ slug: 'payments', name: 'Payments', source_paths: ['src/payments/stripe.ts'] }),
      mod({ slug: 'billing', name: 'Billing', source_paths: ['src/billing/stripe.ts'] }),
      mod({ slug: 'invoices', name: 'Invoices', source_paths: ['src/invoices/stripe.ts'] }),
      mod({ slug: 'subscriptions', name: 'Subscriptions', source_paths: ['src/subs/stripe.ts'] }),
    ]);
    const result = inferAttribution({
      prompt: 'wire stripe everywhere',
      moduleMap: m,
      maxChoices: 2,
    });
    const existing = result.choices.filter((c) => c.kind === 'extend-existing');
    expect(existing).toHaveLength(2);
  });

  it('always includes both fallback choices in stable order', () => {
    const m = map([
      mod({ slug: 'payments', name: 'Payments', source_paths: ['src/payments/stripe.ts'] }),
    ]);
    const result = inferAttribution({ prompt: 'stripe', moduleMap: m });
    const last2 = result.choices.slice(-2).map((c) => c.kind);
    expect(last2).toEqual(['new-module-fallback', 'no-attribution']);
  });

  it('drops stop words and short tokens from the prompt set', () => {
    const result = inferAttribution({
      prompt: 'we will add the new feature to it on the of',
      moduleMap: null,
    });
    expect(result.prompt_tokens).toEqual([]);
  });

  it('weights name tokens above source-path tokens', () => {
    const m = map([
      mod({
        slug: 'payments',
        name: 'Payments',
        source_paths: ['src/logging/payments-logger.ts'],
      }),
      mod({
        slug: 'logging',
        name: 'Logging',
        source_paths: ['src/observability/**'],
      }),
    ]);
    const result = inferAttribution({ prompt: 'fix the logging output', moduleMap: m });
    expect(result.choices[0]?.slug).toBe('logging');
  });

  describe('the 0.5 confidence floor', () => {
    const vocab = Array.from({ length: 100 }, (_, i) => `tok${String(i).padStart(3, '0')}x`);

    function scored(matches: number) {
      const m = map([
        mod({
          slug: 'zeta',
          name: 'Zeta',
          source_paths: vocab.slice(0, matches).map((token) => `src/${token}.ts`),
        }),
      ]);
      return inferAttribution({ prompt: vocab.join(' '), moduleMap: m });
    }

    it('AC-9: a top score of exactly 0.5 is confident and its choice leads', () => {
      const result = scored(50);
      expect(result.choices[0]?.score).toBe(0.5);
      expect(result.choices[0]?.kind).toBe('extend-existing');
      expect(result.choices[0]?.slug).toBe('zeta');
      expect(result.confident).toBe(true);
    });

    it('AC-9: top scores of 0.49 and 0.2 are not confident', () => {
      const justUnder = scored(49);
      expect(justUnder.choices[0]?.score).toBe(0.49);
      expect(justUnder.confident).toBe(false);
      const old = scored(20);
      expect(old.choices[0]?.score).toBe(0.2);
      expect(old.confident).toBe(false);
    });

    it('AC-9: no candidate at all falls back to no-attribution', () => {
      const result = inferAttribution({ prompt: vocab.join(' '), moduleMap: map([]) });
      expect(result.confident).toBe(false);
      expect(result.choices.map((choice) => choice.kind)).toEqual([
        'new-module-fallback',
        'no-attribution',
      ]);
    });
  });
});
