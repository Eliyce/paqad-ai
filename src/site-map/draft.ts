// The deterministic map-drafting stage (S8a): turn an already-gathered ExtractionResult into a
// schema-valid canonical AppMap skeleton, so the model adds meaning instead of retyping hundreds
// of surface entries by hand (fixes D2). This module is PURE — no filesystem, no shell — mirroring
// how `extraction.ts` keeps every branch testable with fixtures; the impure gather-and-write half
// lives in the `sitemap draft` CLI verb. The skeleton invents nothing: it carries only what the
// extractor proved (one surface per extracted surface, evidence unchanged, module hints as-is) and
// emits no transitions, journeys, or actors. Links arrive in S9; the model adds the rest.

import type { AppKind, AppMap, Area, Surface } from '@/core/types/site-map.js';
import { SITE_MAP_SCHEMA_VERSION } from '@/core/types/site-map.js';
import type { SiteMapAppSummary } from '@/core/types/site-map-run.js';
import { slugify } from '@/pentest/shared.js';

import type { ExtractionResult } from './extraction.js';
import { deriveSiteMapInventory } from './run.js';

/** The area id for a module attribution: its slug, falling back to the raw name if it has no word chars. */
function areaIdFor(module: string): string {
  const slug = slugify(module);
  return slug.length > 0 ? slug : module;
}

/**
 * Build the canonical map skeleton from a gathered extraction (pure — no I/O). One surface entry per
 * extracted surface, in extraction order, carrying only proven material: `id` from the extractor's
 * `raw_id`, the `kind` and `label` as extracted, the `evidence` passed through byte-for-byte, the
 * `entry` and `module` when the extractor revealed them, and the raw middleware `guards` hints onto
 * the map's `guard` ref (the later guard-inference stage resolves those into typed guards). Areas are
 * derived from the module map — the sorted distinct module attributions the extraction found — so a
 * surface with a module points at its area. Nothing is invented: no transitions, no journeys, no
 * actors, no top-level guards. `schema_version` is the integer 1.
 */
export function buildSiteMapDraft(extraction: ExtractionResult, app: SiteMapAppSummary): AppMap {
  const groups = deriveSiteMapInventory(extraction).groups;

  // One area per distinct module, deduped by the id we slug it to (two module names could slug to
  // the same id), preserving the sorted order the inventory produced.
  const areasById = new Map<string, Area>();
  for (const module of groups) {
    const id = areaIdFor(module);
    if (!areasById.has(id)) areasById.set(id, { id, label: module });
  }
  const areas = [...areasById.values()];

  const surfaces: Surface[] = extraction.surfaces.map((surface) => {
    const entry: Surface = {
      id: surface.raw_id,
      kind: surface.kind,
      label: surface.label,
      evidence: surface.evidence,
    };
    if (surface.entry !== undefined) entry.entry = surface.entry;
    if (surface.module !== undefined) {
      entry.module = surface.module;
      entry.area = areaIdFor(surface.module);
    }
    if (surface.guards !== undefined && surface.guards.length > 0) {
      entry.guard = surface.guards;
    }
    return entry;
  });

  const map: AppMap = {
    schema_version: SITE_MAP_SCHEMA_VERSION,
    app: {
      name: app.name,
      kind: app.kind as AppKind,
      frameworks: app.frameworks,
    },
    // areas before surfaces, matching the canonical field order (see AppMap).
    ...(areas.length > 0 ? { areas } : {}),
    surfaces,
  };
  return map;
}
