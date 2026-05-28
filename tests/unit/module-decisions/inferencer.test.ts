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
        features: [{ name: 'Stripe Webhooks', slug: 'stripe-webhooks', auto_update_feature_name: false, derivation: 'user', confidence: 'high', source_paths: [] }],
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
    expect(result.confident).toBe(true);
    expect(result.choices[0]?.matched_tokens).toContain('stripe');
  });

  it('marks not-confident when no existing module clears the floor', () => {
    const m = map([mod({ slug: 'auth', name: 'Auth', source_paths: ['src/auth/**'] })]);
    const result = inferAttribution({
      prompt: 'tweak invoice rendering for euro currencies',
      moduleMap: m,
    });
    expect(result.confident).toBe(false);
    // Fallback choices still present.
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
    const m = map([mod({ slug: 'payments', name: 'Payments', source_paths: ['src/payments/stripe.ts'] })]);
    const result = inferAttribution({ prompt: 'stripe', moduleMap: m });
    const last2 = result.choices.slice(-2).map((c) => c.kind);
    expect(last2).toEqual(['new-module-fallback', 'no-attribution']);
  });

  it('drops stop words and short tokens from the prompt set', () => {
    const result = inferAttribution({
      prompt: 'we will add the new feature to it on the of',
      moduleMap: null,
    });
    // All function/stop words; nothing should remain.
    expect(result.prompt_tokens).toEqual([]);
  });

  it('weights name tokens above source-path tokens', () => {
    const m = map([
      mod({
        slug: 'payments',
        name: 'Payments',
        // Path-only signal for "logging".
        source_paths: ['src/logging/payments-logger.ts'],
      }),
      mod({
        slug: 'logging',
        name: 'Logging',
        // Name signal for "logging".
        source_paths: ['src/observability/**'],
      }),
    ]);
    const result = inferAttribution({ prompt: 'fix the logging output', moduleMap: m });
    expect(result.choices[0]?.slug).toBe('logging');
  });
});
