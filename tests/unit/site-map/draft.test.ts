import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SurfaceKind } from '@/core/types/site-map.js';
import type { SiteMapAppSummary } from '@/core/types/site-map-run.js';
import { buildSiteMapDraft } from '@/site-map/draft.js';
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
