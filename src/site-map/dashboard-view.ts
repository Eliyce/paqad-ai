// The static payload the dashboard renders as the interactive visual site map (issue #466).
// This is the whole "data reaches the browser" seam: the full AI-authored map (surfaces,
// transitions, areas, actors, guards, and the per-journey step detail) is read from the single
// canonical `docs/site-map/` YML and handed to the client as-is. Nothing here calls an LLM, so
// the dashboard is static and reproducible (NFR-4, NFR-5): the same YML always yields the same
// payload. When the `site_map` flag is off the payload is inert (INV-1, NFR-3).

import { resolveFrameworkConfig } from '@/core/framework-config.js';
import type { AppMap, Journey } from '@/core/types/site-map.js';

import { readAllCanonicalJourneys, readCanonicalSiteMap } from './store.js';

/** How fresh the map is, so the viewer can judge whether to trust it (FRESH-1). */
export interface SiteMapFreshness {
  /** The code state the map was authored against (a commit ref), or null when unstated. */
  generated_from: string | null;
}

/**
 * The dashboard's view of the site map. A discriminated union so the client renders exactly one
 * honest state and never a map with no basis:
 *  - `disabled`  — the `site_map` flag is off; nothing is served (INV-1).
 *  - `empty`     — the flag is on but no map has been authored yet (STATE-1).
 *  - `ready`     — the full map plus its journeys, read statically from the canonical YML.
 */
export type SiteMapView =
  | { status: 'disabled' }
  | { status: 'empty' }
  | { status: 'ready'; map: AppMap; journeys: Journey[]; freshness: SiteMapFreshness };

/**
 * Build the static site-map payload for the dashboard. Reads only the stored canonical artifact
 * (`docs/site-map/app-map.yaml` + `journeys/*.journey.yaml`); it never runs the model, so it is
 * safe to call on every dashboard poll.
 */
export function buildSiteMapView(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): SiteMapView {
  if (!resolveFrameworkConfig(projectRoot, env).features.site_map) {
    return { status: 'disabled' };
  }

  const map = readCanonicalSiteMap(projectRoot);
  if (map === null) {
    return { status: 'empty' };
  }

  return {
    status: 'ready',
    map,
    journeys: readAllCanonicalJourneys(projectRoot),
    freshness: { generated_from: map.app.generated_from ?? null },
  };
}
