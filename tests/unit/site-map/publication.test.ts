import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import type { AppMap } from '@/core/types/site-map.js';
import {
  assembleSiteMapPublication,
  buildSiteMapIndex,
  buildSiteMapOverview,
  buildSiteMapRegistries,
  estimateTokens,
  SITE_MAP_CONSULT_RULE,
  toMermaidId,
} from '@/site-map/publication.js';

import { minimalAppMap, validAppMap } from '../../fixtures/site-map/valid-app-map.js';

/**
 * A crafted map exercising the branches the two shipped fixtures don't: single-string guards,
 * an entry with a kind but no value, a status-less journey, two frontstage areas, an empty area,
 * a backstage area with no surfaces, a loose (area-less) surface, a decision-pause node, api and
 * webhook surfaces, and transitions with a single guard, a list guard, and a missing target.
 */
function richMap(): AppMap {
  return {
    schema_version: 1,
    app: { name: 'rich', kind: 'web' },
    areas: [
      { id: 'a-front', label: 'Front A' },
      { id: 'b-front', label: 'Front B' },
      { id: 'empty', label: 'Empty area' },
      { id: 'back', label: 'Back', visibility: 'backstage' },
    ],
    guards: [{ id: 'g1', kind: 'permission', label: 'Guard one' }],
    surfaces: [
      {
        id: 's.home',
        kind: 'page',
        label: 'Home',
        area: 'a-front',
        entry: { kind: 'url', value: '/home' },
        guard: 'g1',
        transitions: [
          { to: 's.api', trigger: 'call', guard: 'g1' },
          { to: 's.hook', trigger: 'emit', guard: ['g1'] },
          { to: 's.missing', trigger: 'ghost' },
        ],
      },
      {
        id: 's.cmd',
        kind: 'decision-pause',
        label: 'Pause here',
        area: 'b-front',
        entry: { kind: 'command' },
      },
      { id: 's.api', kind: 'api', label: 'Orders API' },
      { id: 's.hook', kind: 'webhook', label: 'Stripe hook', area: 'a-front' },
    ],
    journeys: [{ id: 'j.no-status', label: 'No status journey' }],
  };
}

describe('estimateTokens', () => {
  it('estimates ~4 characters per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('buildSiteMapIndex', () => {
  it('projects entries, areas, guards, and journeys from a rich map', () => {
    const index = buildSiteMapIndex(validAppMap(), 2);
    expect(index).toContain('# aurelia-shop — site map index');
    expect(index).toContain('web + llm-workflows');
    expect(index).toContain(SITE_MAP_CONSULT_RULE);
    // An entry surface without a guard renders no guard note.
    expect(index).toContain('- **Products** — /products');
    // A backstage area is marked and counted.
    expect(index).toContain('(backstage)');
    expect(index).toContain('`authenticated` (auth-state)');
    expect(index).toContain('**Shopper buys a product** (`checkout`, confirmed)');
    // Under the default budget the optional background tier is present, not the omission note.
    expect(index).toContain('## Background (optional detail)');
    expect(index).not.toContain('omitted to stay within');
  });

  it('renders the empty-map placeholders and single-kind header', () => {
    const index = buildSiteMapIndex(minimalAppMap(), 0);
    expect(index).toContain('# tiny — site map index');
    expect(index).toContain('cli.'); // single-kind app renders the bare kind
    expect(index).toContain('_No entry surfaces recorded._');
    expect(index).toContain('_No areas recorded._');
    expect(index).toContain('_No guards recorded._');
    expect(index).toContain('_No journeys recorded._');
  });

  it('renders an entry guard note, a kind-only entry, and a status-less journey', () => {
    const index = buildSiteMapIndex(richMap(), 1);
    expect(index).toContain('- **Home** — /home (guard: g1)');
    expect(index).toContain('- **Pause here** — command');
    expect(index).toContain('**No status journey** (`j.no-status`, proposed)');
    // A backstage area with no surfaces still lists, with an explicit placeholder.
    expect(index).toContain('**Back**: _no surfaces_');
  });

  it('drops the optional tier and notes the omission when the budget is tight', () => {
    const index = buildSiteMapIndex(richMap(), 1, 5);
    expect(index).toContain(
      '_Optional background detail omitted to stay within the 5-token index budget._',
    );
    expect(index).not.toContain('## Background (optional detail)');
  });
});

describe('toMermaidId', () => {
  it('replaces every non-alphanumeric character with an underscore', () => {
    expect(toMermaidId('cli.onboard')).toBe('cli_onboard');
    expect(toMermaidId('a-b.c')).toBe('a_b_c');
  });
});

describe('buildSiteMapOverview', () => {
  it('emits a deterministic Mermaid graph with district subgraphs and labelled edges', () => {
    const overview = buildSiteMapOverview(validAppMap());
    expect(overview).toContain('# aurelia-shop — behavioural overview');
    expect(overview).toContain('```mermaid');
    expect(overview).toContain('flowchart LR');
    expect(overview).toContain('subgraph storefront["Storefront"]');
    // A terminal renders as a stadium, a router as a diamond, a page as a rectangle.
    expect(overview).toContain('agent_noop(["Plain reply"])');
    expect(overview).toContain('agent_router{"Workflow router"}');
    expect(overview).toContain('catalog_list["Products"]');
    // A guard-less transition carries just its trigger.
    expect(overview).toContain('catalog_list -->|"click"| checkout_express');
    // The output is byte-stable across calls.
    expect(buildSiteMapOverview(validAppMap())).toBe(overview);
  });

  it('sorts sibling frontstage districts, skips empty ones, floats area-less surfaces, and drops edges to missing targets', () => {
    const overview = buildSiteMapOverview(richMap());
    expect(overview).toContain('subgraph a_front["Front A"]');
    expect(overview).toContain('subgraph b_front["Front B"]');
    expect(overview).not.toContain('Empty area'); // area with no surfaces is skipped
    expect(overview).toContain('s_cmd{"Pause here"}'); // decision-pause → diamond
    expect(overview).toContain('s_api["Orders API"]'); // area-less surface floats loose
    // Guarded edges carry the guard in brackets; the edge to a missing target is dropped.
    expect(overview).toContain('s_home -->|"call [g1]"| s_api');
    expect(overview).toContain('s_home -->|"emit [g1]"| s_hook');
    expect(overview).not.toContain('s_missing');
  });
});

describe('buildSiteMapRegistries', () => {
  it('projects screens but omits an empty api registry', () => {
    const registries = buildSiteMapRegistries(validAppMap());
    expect(registries.map((output) => output.path)).toEqual([PATHS.SITE_MAP_SCREEN_REGISTRY]);
    const screen = registries[0]!.contents;
    expect(screen).toContain('# Screen registry');
    expect(screen).toContain('| `catalog.list` | Products | storefront | — |');
    expect(screen).toContain(
      '| `checkout.express` | Checkout (express) | storefront | authenticated, flag.new-checkout |',
    );
  });

  it('projects both a screen and an api registry, with an area-less row', () => {
    const registries = buildSiteMapRegistries(richMap());
    expect(registries.map((output) => output.path)).toEqual([
      PATHS.SITE_MAP_SCREEN_REGISTRY,
      PATHS.SITE_MAP_API_REGISTRY,
    ]);
    const api = registries[1]!.contents;
    expect(api).toContain('# API registry');
    expect(api).toContain('| `s.api` | Orders API | — | — |');
    expect(api).toContain('| `s.hook` | Stripe hook | a-front | — |');
  });

  it('emits no registries for a map with neither screens nor apis', () => {
    expect(buildSiteMapRegistries(minimalAppMap())).toEqual([]);
  });
});

describe('assembleSiteMapPublication', () => {
  it('assembles index, overview, and the applicable registries in a stable order', () => {
    const outputs = assembleSiteMapPublication(validAppMap(), 2);
    expect(outputs.map((output) => output.path)).toEqual([
      PATHS.SITE_MAP_INDEX,
      PATHS.SITE_MAP_OVERVIEW,
      PATHS.SITE_MAP_SCREEN_REGISTRY,
    ]);
    for (const output of outputs) {
      expect(output.source_files).toEqual([PATHS.SITE_MAP_APP_MAP]);
    }
  });

  it('assembles only index and overview when the map has no registrable surfaces', () => {
    const outputs = assembleSiteMapPublication(minimalAppMap(), 0);
    expect(outputs.map((output) => output.path)).toEqual([
      PATHS.SITE_MAP_INDEX,
      PATHS.SITE_MAP_OVERVIEW,
    ]);
  });
});
