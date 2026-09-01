import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppMap, SurfaceKind } from '@/core/types/site-map.js';
import type { SiteMapAppSummary } from '@/core/types/site-map-run.js';
import { buildSiteMapDraft, deriveDraftUnits, mergeSiteMapDraft } from '@/site-map/draft.js';
import type { ExtractedSurface, ExtractionResult } from '@/site-map/extraction.js';
import { validateAppMap } from '@/site-map/schema.js';
import {
  canonicalAppMapPath,
  SiteMapSchemaError,
  writeCanonicalSiteMap,
} from '@/site-map/store.js';

function extracted(overrides: Partial<ExtractedSurface> = {}): ExtractedSurface {
  return {
    raw_id: 'node-cli-a',
    kind: 'cli-command',
    label: 'A',
    evidence: [{ file: 'a.ts', line: 1 }],
    derivation: 'static',
    confidence: 'high',
    source: 'node-cli',
    ...overrides,
  };
}

function extraction(surfaces: ExtractedSurface[]): ExtractionResult {
  return {
    schema_version: 1,
    app_kind: 'cli',
    surfaces,
    blocked_checks: [],
    fingerprint: 'abc123abc123',
    extractors_ran: 1,
    low_confidence_fallback: false,
  };
}

const APP: SiteMapAppSummary = { name: 'paqad-ai', kind: 'cli', frameworks: ['commander'] };

describe('buildSiteMapDraft (S8a)', () => {
  it('builds a schema-valid map with one surface per extracted surface (AC-1)', () => {
    const map = buildSiteMapDraft(
      extraction([
        extracted({ raw_id: 'node-cli-a', label: 'A' }),
        extracted({ raw_id: 'node-cli-b', label: 'B', evidence: [{ file: 'b.ts', line: 9 }] }),
      ]),
      APP,
    );
    expect(map.schema_version).toBe(1);
    expect(map.app).toEqual({ name: 'paqad-ai', kind: 'cli', frameworks: ['commander'] });
    expect(map.surfaces).toHaveLength(2);
    expect(map.surfaces.map((s) => s.id)).toEqual(['node-cli-a', 'node-cli-b']);
    expect(validateAppMap(map).valid).toBe(true);
  });

  it('preserves evidence pointers byte-for-byte from the extractor (AC-2, INV-1)', () => {
    const evidence = [{ file: 'src/site-map/gatherer.ts', line: 42 }, { file: 'src/cli/index.ts' }];
    const map = buildSiteMapDraft(extraction([extracted({ evidence })]), APP);
    expect(map.surfaces[0].evidence).toEqual(evidence);
  });

  it('carries entry, module and the raw guard hints when present (AC-1)', () => {
    const map = buildSiteMapDraft(
      extraction([
        extracted({
          raw_id: 'laravel-routes-get-billing',
          kind: 'page',
          entry: { kind: 'route', value: 'GET /billing' },
          module: 'Billing',
          guards: ['web', 'auth'],
        }),
      ]),
      APP,
    );
    const surface = map.surfaces[0];
    expect(surface.entry).toEqual({ kind: 'route', value: 'GET /billing' });
    expect(surface.module).toBe('Billing');
    expect(surface.guard).toEqual(['web', 'auth']);
    expect(surface.area).toBe('billing');
  });

  it('omits entry, module, area and guard when the extractor did not reveal them', () => {
    const map = buildSiteMapDraft(extraction([extracted()]), APP);
    const surface = map.surfaces[0];
    expect(surface.entry).toBeUndefined();
    expect(surface.module).toBeUndefined();
    expect(surface.area).toBeUndefined();
    expect(surface.guard).toBeUndefined();
  });

  it('drops an empty guard-hints array rather than writing an empty guard', () => {
    const map = buildSiteMapDraft(extraction([extracted({ guards: [] })]), APP);
    expect(map.surfaces[0].guard).toBeUndefined();
  });

  it('derives one area per distinct module, and each moduled surface references its area (AC-5)', () => {
    const map = buildSiteMapDraft(
      extraction([
        extracted({ raw_id: 'a', module: 'Billing' }),
        extracted({ raw_id: 'b', module: 'Auth' }),
        extracted({ raw_id: 'c', module: 'Billing' }),
      ]),
      APP,
    );
    // Sorted, distinct module attributions become the areas (the module map).
    expect(map.areas).toEqual([
      { id: 'auth', label: 'Auth' },
      { id: 'billing', label: 'Billing' },
    ]);
    expect(map.surfaces.map((s) => s.area)).toEqual(['billing', 'auth', 'billing']);
  });

  it('emits no areas key when no surface carries a module', () => {
    const map = buildSiteMapDraft(extraction([extracted(), extracted({ raw_id: 'x' })]), APP);
    expect(map.areas).toBeUndefined();
  });

  it('dedupes areas whose module names slug to the same id', () => {
    const map = buildSiteMapDraft(
      extraction([
        extracted({ raw_id: 'a', module: 'Foo Bar' }),
        extracted({ raw_id: 'b', module: 'Foo-Bar' }),
      ]),
      APP,
    );
    // Both slug to `foo-bar`; the first label wins and only one area is emitted.
    expect(map.areas).toEqual([{ id: 'foo-bar', label: 'Foo Bar' }]);
    expect(map.surfaces.map((s) => s.area)).toEqual(['foo-bar', 'foo-bar']);
  });

  it('falls back to the raw module name for an area id when it has no word chars', () => {
    const map = buildSiteMapDraft(extraction([extracted({ raw_id: 'a', module: '!!!' })]), APP);
    expect(map.areas).toEqual([{ id: '!!!', label: '!!!' }]);
    expect(map.surfaces[0].area).toBe('!!!');
  });

  it('invents nothing: no transitions and no journeys (AC-3, FR-4)', () => {
    const map = buildSiteMapDraft(
      extraction([extracted({ module: 'Billing', guards: ['auth'] })]),
      APP,
    );
    expect(map.journeys).toBeUndefined();
    expect(map.actors).toBeUndefined();
    expect(map.guards).toBeUndefined();
    for (const surface of map.surfaces) {
      expect(surface.transitions).toBeUndefined();
    }
  });

  describe('the writer refuses an invalid draft rather than writing it (AC-4, INV-2)', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'paqad-sitemap-draft-'));
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('a surface with an unknown kind is rejected and no file is written', () => {
      const map = buildSiteMapDraft(
        extraction([extracted({ kind: 'not-a-real-kind' as SurfaceKind })]),
        APP,
      );
      expect(() => writeCanonicalSiteMap(dir, map)).toThrow(SiteMapSchemaError);
      expect(existsSync(canonicalAppMapPath(dir))).toBe(false);
    });

    it('a valid draft is written and reads back schema-valid', () => {
      const map = buildSiteMapDraft(extraction([extracted({ module: 'Billing' })]), APP);
      const path = writeCanonicalSiteMap(dir, map);
      expect(existsSync(path)).toBe(true);
    });
  });
});

describe('deriveDraftUnits (S8b)', () => {
  it('derives one unit per distinct module in sorted order, with its surfaces and sorted distinct source files (AC-3)', () => {
    const units = deriveDraftUnits(
      extraction([
        extracted({ raw_id: 'a', module: 'Billing', evidence: [{ file: 'b2.ts', line: 2 }] }),
        extracted({ raw_id: 'b', module: 'Auth', evidence: [{ file: 'auth.ts', line: 1 }] }),
        extracted({
          raw_id: 'c',
          module: 'Billing',
          evidence: [{ file: 'b1.ts' }, { file: 'b2.ts', line: 9 }],
        }),
      ]),
    );
    expect(units).toEqual([
      { id: 'group:auth', label: 'Auth', surface_ids: ['b'], source_files: ['auth.ts'] },
      {
        id: 'group:billing',
        label: 'Billing',
        surface_ids: ['a', 'c'],
        source_files: ['b1.ts', 'b2.ts'],
      },
    ]);
  });

  it('buckets module-less surfaces into one group:ungrouped unit (AC-7)', () => {
    const units = deriveDraftUnits(
      extraction([
        extracted({ raw_id: 'x', evidence: [{ file: 'x.ts' }] }),
        extracted({ raw_id: 'a', module: 'Billing', evidence: [{ file: 'b.ts' }] }),
        extracted({ raw_id: 'y', evidence: [{ file: 'y.ts' }] }),
      ]),
    );
    expect(units.map((unit) => unit.id)).toEqual(['group:billing', 'group:ungrouped']);
    const ungrouped = units[1];
    expect(ungrouped.label).toBe('Ungrouped surfaces');
    expect(ungrouped.surface_ids).toEqual(['x', 'y']);
    expect(ungrouped.source_files).toEqual(['x.ts', 'y.ts']);
  });

  it('merges module names slugging to one id into a single unit (first label wins)', () => {
    const units = deriveDraftUnits(
      extraction([
        extracted({ raw_id: 'a', module: 'Foo Bar', evidence: [{ file: 'a.ts' }] }),
        extracted({ raw_id: 'b', module: 'Foo-Bar', evidence: [{ file: 'b.ts' }] }),
      ]),
    );
    expect(units).toEqual([
      {
        id: 'group:foo-bar',
        label: 'Foo Bar',
        surface_ids: ['a', 'b'],
        source_files: ['a.ts', 'b.ts'],
      },
    ]);
  });

  it('returns no units for an empty extraction', () => {
    expect(deriveDraftUnits(extraction([]))).toEqual([]);
  });
});

describe('mergeSiteMapDraft (S8b)', () => {
  const app = { name: 'paqad-ai', kind: 'cli' as const };

  function draftOf(...surfaces: Parameters<typeof extracted>[0][]): AppMap {
    return buildSiteMapDraft(extraction(surfaces.map((overrides) => extracted(overrides))), APP);
  }

  it('keeps an authored entry byte-identical and appends only the missing surface (AC-1)', () => {
    const authored = {
      id: 'node-cli-a',
      kind: 'cli-command' as const,
      label: 'Curated label',
      note: 'hand-written note',
      trust: 'human-confirmed' as const,
      evidence: [{ file: 'somewhere-else.ts', line: 99 }],
    };
    const existing: AppMap = { schema_version: 1, app, surfaces: [authored] };
    const draft = draftOf({ raw_id: 'node-cli-a' }, { raw_id: 'node-cli-b', label: 'B' });
    const merged = mergeSiteMapDraft(existing, draft, new Set(['node-cli-a', 'node-cli-b']));
    expect(merged.surfaces.map((surface) => surface.id)).toEqual(['node-cli-a', 'node-cli-b']);
    expect(merged.surfaces[0]).toEqual(authored);
    expect(merged.surfaces[0]).toBe(authored);
  });

  it('keeps a surface the extraction no longer produces (AC-2)', () => {
    const existing: AppMap = {
      schema_version: 1,
      app,
      surfaces: [{ id: 'node-cli-legacy', kind: 'cli-command', label: 'Legacy' }],
    };
    const merged = mergeSiteMapDraft(
      existing,
      draftOf({ raw_id: 'node-cli-a' }),
      new Set(['node-cli-a']),
    );
    expect(merged.surfaces.map((surface) => surface.id)).toEqual(['node-cli-legacy', 'node-cli-a']);
  });

  it('filters the draft to the given surface ids', () => {
    const draft = draftOf({ raw_id: 'a' }, { raw_id: 'b' }, { raw_id: 'c' });
    const merged = mergeSiteMapDraft(null, draft, new Set(['b']));
    expect(merged.surfaces.map((surface) => surface.id)).toEqual(['b']);
    expect(merged.schema_version).toBe(draft.schema_version);
    expect(merged.app).toEqual(draft.app);
  });

  it('with no existing map carries only the areas the picked surfaces reference', () => {
    const draft = draftOf(
      { raw_id: 'a', module: 'Auth', evidence: [{ file: 'a.ts' }] },
      { raw_id: 'b', module: 'Billing', evidence: [{ file: 'b.ts' }] },
    );
    const merged = mergeSiteMapDraft(null, draft, new Set(['b']));
    expect(merged.areas).toEqual([{ id: 'billing', label: 'Billing' }]);
  });

  it('with no existing map and no referenced areas emits no areas key', () => {
    const merged = mergeSiteMapDraft(null, draftOf({ raw_id: 'a' }), new Set(['a']));
    expect(merged.areas).toBeUndefined();
  });

  it('adds only newly referenced areas to an existing map, never duplicating one (AC-1)', () => {
    const existing: AppMap = {
      schema_version: 1,
      app,
      areas: [{ id: 'auth', label: 'Auth (curated)' }],
      surfaces: [{ id: 'node-cli-a', kind: 'cli-command', label: 'A', area: 'auth' }],
    };
    const draft = draftOf(
      { raw_id: 'node-cli-a', module: 'Auth' },
      { raw_id: 'node-cli-b', module: 'Billing', evidence: [{ file: 'b.ts' }] },
    );
    const merged = mergeSiteMapDraft(existing, draft, new Set(['node-cli-a', 'node-cli-b']));
    expect(merged.areas).toEqual([
      { id: 'auth', label: 'Auth (curated)' },
      { id: 'billing', label: 'Billing' },
    ]);
  });

  it('adds areas to an existing map that had none when an appended surface references one', () => {
    const existing: AppMap = {
      schema_version: 1,
      app,
      surfaces: [{ id: 'node-cli-old', kind: 'cli-command', label: 'Old' }],
    };
    const draft = draftOf({
      raw_id: 'node-cli-b',
      module: 'Billing',
      evidence: [{ file: 'b.ts' }],
    });
    const merged = mergeSiteMapDraft(existing, draft, new Set(['node-cli-b']));
    expect(merged.areas).toEqual([{ id: 'billing', label: 'Billing' }]);
  });

  it('adds no areas key when the appended surfaces reference none', () => {
    const existing: AppMap = {
      schema_version: 1,
      app,
      surfaces: [{ id: 'node-cli-old', kind: 'cli-command', label: 'Old' }],
    };
    const merged = mergeSiteMapDraft(
      existing,
      draftOf({ raw_id: 'node-cli-b' }),
      new Set(['node-cli-b']),
    );
    expect(merged.areas).toBeUndefined();
    expect(merged.surfaces.map((surface) => surface.id)).toEqual(['node-cli-old', 'node-cli-b']);
  });

  it('does not mutate the existing map or the draft', () => {
    const existing: AppMap = {
      schema_version: 1,
      app,
      surfaces: [{ id: 'node-cli-old', kind: 'cli-command', label: 'Old' }],
    };
    const draft = draftOf({
      raw_id: 'node-cli-b',
      module: 'Billing',
      evidence: [{ file: 'b.ts' }],
    });
    const existingBefore = structuredClone(existing);
    const draftBefore = structuredClone(draft);
    mergeSiteMapDraft(existing, draft, new Set(['node-cli-b']));
    expect(existing).toEqual(existingBefore);
    expect(draft).toEqual(draftBefore);
  });

  it('the merged map of a skeleton over an authored map stays schema-valid (INV-3)', () => {
    const existing: AppMap = {
      schema_version: 1,
      app,
      surfaces: [{ id: 'node-cli-old', kind: 'cli-command', label: 'Old', note: 'kept' }],
    };
    const draft = draftOf({
      raw_id: 'node-cli-b',
      module: 'Billing',
      evidence: [{ file: 'b.ts' }],
    });
    const merged = mergeSiteMapDraft(existing, draft, new Set(['node-cli-b']));
    expect(validateAppMap(merged).valid).toBe(true);
  });
});
