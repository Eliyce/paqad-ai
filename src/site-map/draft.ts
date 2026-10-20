import type { AppKind, AppMap, Area, Surface } from '@/core/types/site-map.js';
import { SITE_MAP_SCHEMA_VERSION } from '@/core/types/site-map.js';
import type { SiteMapAppSummary } from '@/core/types/site-map-run.js';
import { slugify } from '@/pentest/shared.js';

import type { ExtractionResult } from './extraction.js';
import { deriveSiteMapInventory } from './run.js';

function areaIdFor(module: string): string {
  const slug = slugify(module);
  return slug.length > 0 ? slug : module;
}

export function buildSiteMapDraft(extraction: ExtractionResult, app: SiteMapAppSummary): AppMap {
  const groups = deriveSiteMapInventory(extraction).groups;

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
    ...(areas.length > 0 ? { areas } : {}),
    surfaces,
  };
  return map;
}

const UNGROUPED_UNIT_ID = 'group:ungrouped';
const UNGROUPED_UNIT_LABEL = 'Ungrouped surfaces';

export interface DraftUnit {
  id: string;
  label: string;
  surface_ids: string[];
  source_files: string[];
}

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
    const unit = byId.get(id)!;
    unit.surface_ids.push(surface.raw_id);
    const seen = files.get(id) ?? new Set<string>();
    for (const evidence of surface.evidence) seen.add(evidence.file);
    files.set(id, seen);
  }

  const units = [...byId.values()];
  for (const unit of units) {
    unit.source_files = [...files.get(unit.id)!].sort((a, b) => a.localeCompare(b));
  }
  return units;
}

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
