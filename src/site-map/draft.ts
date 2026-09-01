// The deterministic map-drafting stage (S8a + S8b): turn an already-gathered ExtractionResult
// into a schema-valid canonical AppMap skeleton, so the model adds meaning instead of retyping
// hundreds of surface entries by hand (fixes D2). This module is PURE — no filesystem, no shell —
// mirroring how `extraction.ts` keeps every branch testable with fixtures; the impure
// gather-and-write half lives in the `sitemap draft` CLI verb. The skeleton invents nothing: it
// carries only what the extractor proved (one surface per extracted surface, evidence unchanged,
// module hints as-is) and emits no transitions, journeys, or actors. Links arrive in S9; the
// model adds the rest. S8b adds the pure halves of additive-and-resumable drafting: the per-group
// resumable units (`deriveDraftUnits`) and the never-clobber merge (`mergeSiteMapDraft`).

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

/** The progress-store unit id and label for the module-less bucket (see deriveDraftUnits). */
const UNGROUPED_UNIT_ID = 'group:ungrouped';
const UNGROUPED_UNIT_LABEL = 'Ungrouped surfaces';

/** One resumable drafting unit (S8b): a module group, or the trailing module-less bucket. */
export interface DraftUnit {
  /** Progress-store unit id, e.g. `group:billing`. */
  id: string;
  /** The raw module name, or `Ungrouped surfaces` for the bucket. */
  label: string;
  /** The draft surface ids (extraction `raw_id`s) this unit merges, in extraction order. */
  surface_ids: string[];
  /** Distinct, sorted evidence files of those surfaces — the unit's staleness inputs. */
  source_files: string[];
}

/**
 * Derive the resumable drafting units from an extraction (pure — no I/O, S8b). One unit per
 * distinct module group in the inventory's sorted order (deduped by the slugged id exactly like
 * the areas, so two module names slugging to one id share one unit), plus one trailing
 * `group:ungrouped` unit when module-less surfaces exist — without it, a project whose extractor
 * attributes no modules (this repo: 95 CLI surfaces, 0 groups) would seed an empty store and a
 * re-run could never resume. Each unit records the distinct, sorted evidence files of its
 * surfaces as `source_files`, which the progress store's skip rule hashes; a synthetic evidence
 * label (e.g. `php artisan route:list`) hashes deterministically as a missing file, so the skip
 * rule stays stable for artisan-sourced surfaces too.
 */
export function deriveDraftUnits(extraction: ExtractionResult): DraftUnit[] {
  const byId = new Map<string, DraftUnit>();
  for (const module of deriveSiteMapInventory(extraction).groups) {
    const id = `group:${areaIdFor(module)}`;
    if (!byId.has(id)) {
      byId.set(id, { id, label: module, surface_ids: [], source_files: [] });
    }
  }

  const files = new Map<string, Set<string>>();
  for (const surface of extraction.surfaces) {
    let id: string;
    if (surface.module !== undefined) {
      id = `group:${areaIdFor(surface.module)}`;
    } else {
      id = UNGROUPED_UNIT_ID;
      if (!byId.has(id)) {
        byId.set(id, { id, label: UNGROUPED_UNIT_LABEL, surface_ids: [], source_files: [] });
      }
    }
    // A module literally named "ungrouped" shares the bucket's unit; the first label wins,
    // matching the area dedupe above, and every surface still belongs to exactly one unit.
    const unit = byId.get(id)!;
    unit.surface_ids.push(surface.raw_id);
    const seen = files.get(id) ?? new Set<string>();
    for (const evidence of surface.evidence) seen.add(evidence.file);
    files.set(id, seen);
  }

  const units = [...byId.values()];
  for (const unit of units) {
    // Every unit owns at least one surface (groups derive from surface modules, and the bucket
    // is only minted when a module-less surface exists), so its file set is always present.
    unit.source_files = [...files.get(unit.id)!].sort((a, b) => a.localeCompare(b));
  }
  return units;
}

/**
 * Merge one unit's slice of the draft into the existing canonical map (pure — no I/O, S8b).
 * Additive and never destructive (AC-1, AC-2): every field of the existing map and every existing
 * surface entry is carried through untouched — authored labels, notes, provenance stamps,
 * transitions, journeys, everything — and a surface the extraction no longer produces is kept,
 * never deleted (the SM-REMOVE finding reports it instead). Only draft surfaces named by
 * `surfaceIds` and absent from the map are appended, in draft order, and only the areas those
 * appended surfaces reference (and the map does not already have) are added with them. With no
 * existing map the filtered draft itself is returned, so a first run and a resumed run share one
 * code path.
 */
export function mergeSiteMapDraft(
  existing: AppMap | null,
  draft: AppMap,
  surfaceIds: ReadonlySet<string>,
): AppMap {
  const picked = draft.surfaces.filter((surface) => surfaceIds.has(surface.id));

  if (existing === null) {
    const areas = (draft.areas ?? []).filter((area) =>
      picked.some((surface) => surface.area === area.id),
    );
    return {
      schema_version: draft.schema_version,
      app: draft.app,
      ...(areas.length > 0 ? { areas } : {}),
      surfaces: picked,
    };
  }

  const existingSurfaceIds = new Set(existing.surfaces.map((surface) => surface.id));
  const appended = picked.filter((surface) => !existingSurfaceIds.has(surface.id));

  const existingAreaIds = new Set((existing.areas ?? []).map((area) => area.id));
  const newAreas = (draft.areas ?? []).filter(
    (area) => !existingAreaIds.has(area.id) && appended.some((surface) => surface.area === area.id),
  );

  const merged: AppMap = { ...existing, surfaces: [...existing.surfaces, ...appended] };
  if (newAreas.length > 0) {
    merged.areas = [...(existing.areas ?? []), ...newAreas];
  }
  return merged;
}
