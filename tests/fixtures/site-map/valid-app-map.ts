// Schema-v1-valid fixtures for the site-map store + schema tests. Modeled on the
// hand-authored docs/specs/site-map-samples/ (which stay illustrative at schema_version
// `0-draft` and are never edited — INV-6); these are the strict, versioned equivalents
// that exercise the full app-map + journey vocabulary, including the prompt-flow nodes.

import { SITE_MAP_SCHEMA_VERSION, type AppMap, type Journey } from '@/core/types/site-map.js';

/** A comprehensive, schema-valid app-map covering the classic + prompt-flow families. */
export function validAppMap(): AppMap {
  return {
    schema_version: SITE_MAP_SCHEMA_VERSION,
    app: {
      name: 'aurelia-shop',
      kind: ['web', 'llm-workflows'],
      frameworks: ['laravel', 'react'],
      generated_from: 'main@abc123',
      language: {
        default_locale: 'en',
        locales: ['en', 'de'],
        catalogs: ['resources/lang'],
        label_policy: 'label = default-locale resolution of label_key',
      },
    },
    actors: [
      { id: 'guest', label: 'Guest', satisfies: [] },
      { id: 'shopper', label: 'Shopper', satisfies: ['authenticated'], note: 'signed-in buyer' },
    ],
    guards: [
      {
        id: 'authenticated',
        kind: 'auth-state',
        label: 'Signed in',
        satisfy_via: 'journey:sign-in',
      },
      {
        id: 'flag.new-checkout',
        kind: 'feature-flag',
        label: 'New checkout',
        flag_key: 'new-checkout',
        required_variant: 'on',
        provider: 'unleash',
        owner: 'team-payments',
        lifecycle: 'active',
        introduced: '2026-05-02',
        evidence: { file: 'resources/js/flags.ts', line: 12 },
      },
    ],
    areas: [
      { id: 'storefront', label: 'Storefront' },
      { id: 'fulfillment', label: 'Fulfillment machinery', visibility: 'backstage' },
    ],
    surfaces: [
      {
        id: 'catalog.list',
        kind: 'page',
        label: 'Products',
        label_key: 'catalog.title',
        label_source: 'h1-key',
        labels: { de: 'Produkte' },
        area: 'storefront',
        entry: { kind: 'url', value: '/products' },
        page_type: 'list',
        module: 'catalog',
        evidence: { file: 'routes/web.php', line: 31 },
        derivation: 'static',
        confidence: 'high',
        transitions: [{ to: 'checkout.express', trigger: 'click', note: 'buy now' }],
      },
      {
        id: 'checkout.express',
        kind: 'page',
        label: 'Checkout (express)',
        area: 'storefront',
        guard: ['authenticated', 'flag.new-checkout'],
        page_type: 'form',
        status: 'variant',
        variant_group: 'checkout',
        variant_of: 'checkout.classic',
        ends: { success: true },
        transitions: [{ to: 'external.stripe', trigger: 'hand-off' }],
      },
      {
        id: 'external.stripe',
        kind: 'external-system',
        label: 'Stripe payment',
        area: 'storefront',
        visibility: 'frontstage',
        hand_off: { carries: 'payment session token', returns: true },
        transitions: [
          { to: 'catalog.list', trigger: 'redirect', note: 'cancelled', carries: 'nothing' },
        ],
      },
      {
        id: 'jobs.fulfillment',
        kind: 'job',
        label: 'Fulfillment pipeline',
        area: 'fulfillment',
        visibility: 'backstage',
        note: 'invisible to shoppers',
      },
      // A prompt-flow router surface with a mandatory fallback edge + guard modes.
      {
        id: 'agent.router',
        kind: 'router',
        label: 'Workflow router',
        area: 'storefront',
        derivation: 'static',
        confidence: 'high',
        evidence: [{ file: 'runtime/AGENT-BOOTSTRAP.md', line: 25, note: 'the workflow list' }],
        transitions: [
          {
            to: 'agent.feature',
            trigger: 'route',
            guard_text: 'any code change',
            guard_mode: 'llm-judged',
          },
          {
            to: 'agent.noop',
            trigger: 'fallback',
            fallback: true,
            guard_text: 'nothing matched',
          },
        ],
      },
      {
        id: 'agent.feature',
        kind: 'llm-workflow',
        label: 'Build a feature',
        area: 'storefront',
        steps: [
          { id: 'planning', label: 'Plan', type: 'llm', artifact: 'plan.json' },
          {
            id: 'spec',
            label: 'Freeze the spec',
            type: 'decision-pause',
            presents: 'the acceptance criteria',
            decisions: ['confirm', 'revise'],
            resumable: true,
          },
        ],
      },
      { id: 'agent.noop', kind: 'terminal', label: 'Plain reply', area: 'storefront' },
    ],
    journeys: [
      {
        id: 'checkout',
        label: 'Shopper buys a product',
        actor: 'shopper',
        priority: 'high',
        status: 'confirmed',
      },
      { id: 'sign-in', label: 'Shopper signs in', actor: 'guest', status: 'proposed' },
    ],
  };
}

/** A minimal schema-valid app-map (only the required fields). */
export function minimalAppMap(): AppMap {
  return {
    schema_version: SITE_MAP_SCHEMA_VERSION,
    app: { name: 'tiny', kind: 'cli' },
    surfaces: [{ id: 'cli.root', kind: 'cli-command', label: 'Root command' }],
  };
}

/** A comprehensive, schema-valid journey (with a flag-variant step + freeform ends/tests). */
export function validJourney(): Journey {
  return {
    schema_version: SITE_MAP_SCHEMA_VERSION,
    id: 'checkout',
    label: 'Shopper buys a product',
    actor: 'shopper',
    on_behalf_of: 'guest',
    goal: 'A signed-in shopper pays for the items in their cart',
    entry: 'catalog.list',
    uses: ['journey:sign-in'],
    steps: [
      { surface: 'catalog.list', action: 'pick a product', expect: 'product details shown' },
      {
        surface: 'checkout.express',
        variant: { group: 'checkout', when: 'flag.new-checkout ON' },
        action: 'complete single-page checkout',
        expect: 'hand-off to Stripe',
      },
    ],
    branches: [{ at: 'agent.router', when: 'also matches code intent', then: 'routes elsewhere' }],
    ends: {
      success: 'order.confirmation',
      failure: [{ at: 'external.stripe', then: 'catalog.list', note: 'declined' }],
    },
    next_journeys: ['sign-in'],
    tests: [
      { spec: 'tests/e2e/checkout.spec.ts', variant: 'flag OFF' },
      { spec: null, variant: 'flag ON' },
    ],
    priority: 'high',
    status: 'confirmed',
    derivation: 'human',
    evidence: [{ file: 'routes/web.php', line: 31 }],
  };
}

/** A minimal schema-valid journey (only the required fields). */
export function minimalJourney(): Journey {
  return {
    schema_version: SITE_MAP_SCHEMA_VERSION,
    id: 'onboard',
    label: 'Onboard a project',
    actor: 'developer',
    goal: 'Set the project up',
    entry: 'cli.onboard',
    steps: [{ surface: 'cli.onboard' }],
    ends: {},
    status: 'confirmed',
  };
}
